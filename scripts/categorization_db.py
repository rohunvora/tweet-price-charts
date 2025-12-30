#!/usr/bin/env python3
"""
Categorization Database Schema
==============================

DuckDB schema for tweet categorization with versioned runs and overrides.

Tables:
- tweet_events_clustered: The clustered events (source of truth for analysis)
- category_runs: Append-only classification history
- category_view: View that merges latest run with overrides

Overrides are stored in JSONL file (analysis/category_overrides.jsonl) for git tracking.

Design Principles:
1. Event-based: Each row is a clustered event, not a raw tweet
2. Append-only runs: Never mutate, always add new run_id
3. Override persistence: JSONL file survives re-runs
4. No price leakage: Schema explicitly excludes price/impact fields
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
import hashlib

# Try to import duckdb
try:
    import duckdb
except ImportError:
    raise ImportError("duckdb required. Install with: pip install duckdb")


DATA_DIR = Path(__file__).parent.parent / "data"
ANALYSIS_DIR = Path(__file__).parent.parent / "analysis"
DB_PATH = DATA_DIR / "categorization.duckdb"

# Current schema version
SCHEMA_VERSION = "1.0"


def get_connection(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Get a DuckDB connection to the categorization database."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(DB_PATH), read_only=read_only)


def init_schema(conn: Optional[duckdb.DuckDBPyConnection] = None) -> None:
    """Initialize the database schema. Safe to call multiple times."""
    should_close = conn is None
    if conn is None:
        conn = get_connection()

    try:
        # =========================================================================
        # Table: tweet_events_clustered
        # Source of truth for clustered events (what we classify)
        # =========================================================================
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tweet_events_clustered (
                event_id VARCHAR PRIMARY KEY,
                asset_id VARCHAR NOT NULL,
                anchor_tweet_id VARCHAR NOT NULL,
                tweet_ids VARCHAR[] NOT NULL,
                combined_text VARCHAR NOT NULL,
                event_timestamp TIMESTAMP NOT NULL,
                cluster_size INTEGER NOT NULL,
                time_span_seconds INTEGER NOT NULL,
                cluster_reason VARCHAR NOT NULL,  -- 'time_window' or 'explicit_thread'
                founder VARCHAR NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # =========================================================================
        # Table: category_runs
        # Append-only classification history (never mutate, always add)
        # =========================================================================
        conn.execute("""
            CREATE TABLE IF NOT EXISTS category_runs (
                run_id VARCHAR PRIMARY KEY,
                event_id VARCHAR NOT NULL,
                schema_version VARCHAR NOT NULL,
                classification_method VARCHAR NOT NULL,  -- 'rule' or 'llm'
                model VARCHAR,        -- NULL for rule-based
                prompt_hash VARCHAR,  -- NULL for rule-based
                topic VARCHAR NOT NULL,
                intent VARCHAR NOT NULL,
                secondary_intent VARCHAR,
                style_tags VARCHAR[],
                format_tags VARCHAR[],
                needs_review BOOLEAN DEFAULT FALSE,
                reasoning VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES tweet_events_clustered(event_id)
            )
        """)

        # Index for efficient lookups
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_category_runs_event_id
            ON category_runs(event_id)
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_category_runs_created_at
            ON category_runs(created_at)
        """)

        # =========================================================================
        # View: latest_category_runs
        # Latest classification for each event (before overrides)
        # =========================================================================
        conn.execute("""
            CREATE OR REPLACE VIEW latest_category_runs AS
            SELECT DISTINCT ON (event_id)
                run_id,
                event_id,
                schema_version,
                classification_method,
                model,
                prompt_hash,
                topic,
                intent,
                secondary_intent,
                style_tags,
                format_tags,
                needs_review,
                reasoning,
                created_at
            FROM category_runs
            ORDER BY event_id, created_at DESC
        """)

        print(f"Schema initialized at {DB_PATH}")

    finally:
        if should_close:
            conn.close()


def generate_run_id() -> str:
    """Generate a unique run ID."""
    return str(uuid.uuid4())[:8]


def compute_prompt_hash(prompt: str) -> str:
    """Compute a hash of the prompt for reproducibility tracking."""
    return hashlib.sha256(prompt.encode()).hexdigest()[:16]


def save_clustered_event(
    conn: duckdb.DuckDBPyConnection,
    event_id: str,
    asset_id: str,
    anchor_tweet_id: str,
    tweet_ids: list[str],
    combined_text: str,
    event_timestamp: int,  # Unix timestamp
    cluster_size: int,
    time_span_seconds: int,
    cluster_reason: str,  # 'time_window' or 'explicit_thread'
    founder: str,
) -> None:
    """Save a clustered event to the database (upsert)."""
    # Convert Unix timestamp to datetime
    ts = datetime.utcfromtimestamp(event_timestamp)

    conn.execute("""
        INSERT INTO tweet_events_clustered
        (event_id, asset_id, anchor_tweet_id, tweet_ids, combined_text,
         event_timestamp, cluster_size, time_span_seconds, cluster_reason, founder)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (event_id) DO UPDATE SET
            tweet_ids = EXCLUDED.tweet_ids,
            combined_text = EXCLUDED.combined_text,
            cluster_size = EXCLUDED.cluster_size,
            time_span_seconds = EXCLUDED.time_span_seconds,
            cluster_reason = EXCLUDED.cluster_reason
    """, [event_id, asset_id, anchor_tweet_id, tweet_ids, combined_text,
          ts, cluster_size, time_span_seconds, cluster_reason, founder])


def save_classification_run(
    conn: duckdb.DuckDBPyConnection,
    event_id: str,
    classification_method: str,  # 'rule' or 'llm'
    topic: str,
    intent: str,
    secondary_intent: Optional[str] = None,
    style_tags: Optional[list[str]] = None,
    format_tags: Optional[list[str]] = None,
    needs_review: bool = False,
    reasoning: Optional[str] = None,
    model: Optional[str] = None,
    prompt_hash: Optional[str] = None,
) -> str:
    """Save a classification run. Returns the run_id."""
    run_id = generate_run_id()

    conn.execute("""
        INSERT INTO category_runs
        (run_id, event_id, schema_version, classification_method, model, prompt_hash,
         topic, intent, secondary_intent, style_tags, format_tags, needs_review, reasoning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [run_id, event_id, SCHEMA_VERSION, classification_method, model, prompt_hash,
          topic, intent, secondary_intent, style_tags or [], format_tags or [],
          needs_review, reasoning])

    return run_id


def get_latest_classification(
    conn: duckdb.DuckDBPyConnection,
    event_id: str,
) -> Optional[dict]:
    """Get the latest classification for an event."""
    result = conn.execute("""
        SELECT * FROM latest_category_runs WHERE event_id = ?
    """, [event_id]).fetchone()

    if result is None:
        return None

    columns = [desc[0] for desc in conn.description]
    return dict(zip(columns, result))


def load_overrides() -> dict[str, dict]:
    """Load overrides from JSONL file."""
    overrides_path = ANALYSIS_DIR / "category_overrides.jsonl"
    if not overrides_path.exists():
        return {}

    overrides = {}
    with open(overrides_path) as f:
        for line in f:
            if line.strip():
                obj = json.loads(line)
                event_id = obj["event_id"]
                overrides[event_id] = obj

    return overrides


def get_current_view(
    conn: duckdb.DuckDBPyConnection,
    asset_id: Optional[str] = None,
) -> list[dict]:
    """
    Get current classification view: latest runs merged with overrides.

    Returns list of events with their current classification (override if exists,
    otherwise latest run).
    """
    # Get latest runs
    if asset_id:
        results = conn.execute("""
            SELECT
                e.event_id, e.asset_id, e.anchor_tweet_id, e.combined_text,
                e.event_timestamp, e.cluster_size, e.founder,
                r.topic, r.intent, r.secondary_intent, r.style_tags, r.format_tags,
                r.classification_method, r.needs_review, r.reasoning
            FROM tweet_events_clustered e
            LEFT JOIN latest_category_runs r ON e.event_id = r.event_id
            WHERE e.asset_id = ?
            ORDER BY e.event_timestamp
        """, [asset_id]).fetchall()
    else:
        results = conn.execute("""
            SELECT
                e.event_id, e.asset_id, e.anchor_tweet_id, e.combined_text,
                e.event_timestamp, e.cluster_size, e.founder,
                r.topic, r.intent, r.secondary_intent, r.style_tags, r.format_tags,
                r.classification_method, r.needs_review, r.reasoning
            FROM tweet_events_clustered e
            LEFT JOIN latest_category_runs r ON e.event_id = r.event_id
            ORDER BY e.event_timestamp
        """).fetchall()

    columns = ["event_id", "asset_id", "anchor_tweet_id", "combined_text",
               "event_timestamp", "cluster_size", "founder",
               "topic", "intent", "secondary_intent", "style_tags", "format_tags",
               "classification_method", "needs_review", "reasoning"]

    # Load overrides
    overrides = load_overrides()

    # Merge results with overrides
    current_view = []
    for row in results:
        record = dict(zip(columns, row))

        # Apply override if exists
        if record["event_id"] in overrides:
            override = overrides[record["event_id"]]
            if "override_topic" in override:
                record["topic"] = override["override_topic"]
            if "override_intent" in override:
                record["intent"] = override["override_intent"]
            if "override_secondary_intent" in override:
                record["secondary_intent"] = override["override_secondary_intent"]
            if "override_style_tags" in override:
                record["style_tags"] = override["override_style_tags"]
            if "override_format_tags" in override:
                record["format_tags"] = override["override_format_tags"]
            record["is_overridden"] = True
        else:
            record["is_overridden"] = False

        current_view.append(record)

    return current_view


def get_classification_stats(
    conn: duckdb.DuckDBPyConnection,
    asset_id: Optional[str] = None,
) -> dict:
    """Get classification statistics."""
    current = get_current_view(conn, asset_id)

    stats = {
        "total_events": len(current),
        "classified": sum(1 for e in current if e["topic"]),
        "unclassified": sum(1 for e in current if not e["topic"]),
        "needs_review": sum(1 for e in current if e.get("needs_review")),
        "overridden": sum(1 for e in current if e.get("is_overridden")),
        "by_method": {},
        "by_topic": {},
        "by_intent": {},
    }

    for event in current:
        if event["classification_method"]:
            method = event["classification_method"]
            stats["by_method"][method] = stats["by_method"].get(method, 0) + 1

        if event["topic"]:
            topic = event["topic"]
            stats["by_topic"][topic] = stats["by_topic"].get(topic, 0) + 1

        if event["intent"]:
            intent = event["intent"]
            stats["by_intent"][intent] = stats["by_intent"].get(intent, 0) + 1

    return stats


# ============================================================================
# CLI for testing
# ============================================================================

def main():
    """CLI for database operations."""
    import argparse

    parser = argparse.ArgumentParser(description="Categorization database operations")
    parser.add_argument("--init", action="store_true", help="Initialize schema")
    parser.add_argument("--stats", action="store_true", help="Show classification stats")
    parser.add_argument("--asset", type=str, help="Filter by asset ID")
    args = parser.parse_args()

    if args.init:
        conn = get_connection()
        init_schema(conn)
        conn.close()
        print("Schema initialized successfully")

    elif args.stats:
        conn = get_connection(read_only=True)
        try:
            init_schema(conn)  # Ensure schema exists
            stats = get_classification_stats(conn, args.asset)
            print(json.dumps(stats, indent=2))
        finally:
            conn.close()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
