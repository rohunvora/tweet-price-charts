#!/usr/bin/env python3
"""
Tweet Event Clustering
======================

Groups tweets within time windows to eliminate double-counting.
Same author tweets within 15 minutes become a single "event".

Thread Detection:
- If a tweet is a self-reply (reply_to = founder), chain it with parent
  even if >15 minutes apart (capped at 6 hours)
- Requires DuckDB data (--use-db flag) since reply_to isn't in JSON export

Output:
- Clustered events with anchor_tweet_id, tweet_ids[], combined_text
- Metrics showing reduction from raw tweets to clustered events

Usage:
    python cluster_tweets.py --asset pump --asset wif
    python cluster_tweets.py --all
    python cluster_tweets.py --all --use-db  # Use DuckDB for thread detection
"""

import json
import argparse
from datetime import datetime
from pathlib import Path
from collections import defaultdict
import statistics

# Configuration
CLUSTER_WINDOW_SECONDS = 15 * 60  # 15 minutes
THREAD_MAX_GAP_SECONDS = 6 * 60 * 60  # 6 hours max for thread chaining
STATIC_DIR = Path(__file__).parent.parent / "web" / "public" / "static"
ANALYSIS_DIR = Path(__file__).parent.parent / "analysis"
DATA_DIR = Path(__file__).parent.parent / "data"


def load_tweet_events(asset_id: str, use_db: bool = False) -> list[dict]:
    """Load tweet events for an asset.

    Args:
        asset_id: Asset identifier
        use_db: If True, load from DuckDB (includes reply_to). Otherwise, use JSON.
    """
    if use_db:
        return _load_from_db(asset_id)
    else:
        return _load_from_json(asset_id)


def _load_from_json(asset_id: str) -> list[dict]:
    """Load tweet events from static JSON."""
    path = STATIC_DIR / asset_id / "tweet_events.json"
    if not path.exists():
        raise FileNotFoundError(f"No tweet_events.json found for {asset_id}")

    with open(path) as f:
        data = json.load(f)

    return data.get("events", [])


def _load_from_db(asset_id: str) -> list[dict]:
    """Load tweets from DuckDB with reply_to field."""
    try:
        import duckdb
    except ImportError:
        raise ImportError("duckdb required for --use-db. Install with: pip install duckdb")

    db_path = DATA_DIR / "analytics.duckdb"
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")

    conn = duckdb.connect(str(db_path), read_only=True)

    # Get asset info
    asset_info = conn.execute(
        "SELECT name, founder, founder_type, color FROM assets WHERE id = ?",
        [asset_id]
    ).fetchone()

    if not asset_info:
        raise ValueError(f"Asset not found in DB: {asset_id}")

    asset_name, founder, founder_type, color = asset_info

    # Get tweets with reply_to
    result = conn.execute("""
        SELECT
            id, timestamp, text, likes, retweets, replies, impressions, reply_to
        FROM tweets
        WHERE asset_id = ? AND (is_filtered = FALSE OR is_filtered IS NULL)
        ORDER BY timestamp
    """, [asset_id]).fetchall()

    events = []
    for row in result:
        tweet_id, timestamp, text, likes, retweets, replies, impressions, reply_to = row
        events.append({
            "tweet_id": tweet_id,
            "asset_id": asset_id,
            "asset_name": asset_name,
            "founder": founder,
            "asset_color": color,
            "timestamp": int(timestamp.timestamp()),
            "timestamp_iso": timestamp.isoformat() + "Z",
            "text": text,
            "likes": likes or 0,
            "retweets": retweets or 0,
            "replies": replies or 0,
            "impressions": impressions or 0,
            "reply_to": reply_to,  # Username being replied to
        })

    conn.close()
    return events


def cluster_tweets(
    tweets: list[dict],
    window_seconds: int = CLUSTER_WINDOW_SECONDS,
    thread_max_gap: int = THREAD_MAX_GAP_SECONDS
) -> list[dict]:
    """
    Cluster tweets within a time window, with thread detection.

    Clustering rules:
    1. Time-based: Tweets within window_seconds of the anchor are clustered
    2. Thread-based: Self-replies (reply_to = founder) are chained even if
       >window but <thread_max_gap apart

    Returns list of clustered events, each with:
    - event_id: unique identifier
    - anchor_tweet_id: first tweet in cluster
    - tweet_ids: all tweet IDs in cluster
    - combined_text: concatenated text
    - event_timestamp: timestamp of first tweet
    - cluster_size: number of tweets in cluster
    - tweets: list of original tweet objects (for reference)
    - is_thread: True if cluster was formed via thread detection
    """
    if not tweets:
        return []

    # Sort by timestamp
    sorted_tweets = sorted(tweets, key=lambda x: x["timestamp"])

    # Get founder handle for self-reply detection
    founder = sorted_tweets[0].get("founder", "").lower() if sorted_tweets else ""

    clusters = []
    current_cluster = [sorted_tweets[0]]
    is_thread = False

    for tweet in sorted_tweets[1:]:
        # Check if within window of the anchor tweet
        time_diff = tweet["timestamp"] - current_cluster[-1]["timestamp"]  # Check vs last tweet, not anchor
        anchor_diff = tweet["timestamp"] - current_cluster[0]["timestamp"]

        # Rule 1: Within time window of last tweet
        within_window = time_diff <= window_seconds

        # Rule 2: Self-reply thread (reply_to matches founder)
        # Only if within thread_max_gap of anchor
        reply_to = tweet.get("reply_to", "")
        is_self_reply = (
            reply_to and
            reply_to.lower() == founder and
            anchor_diff <= thread_max_gap
        )

        if within_window or is_self_reply:
            # Add to current cluster
            current_cluster.append(tweet)
            if is_self_reply and not within_window:
                is_thread = True  # Mark that we used thread detection
        else:
            # Finalize current cluster and start new one
            clusters.append(_finalize_cluster(current_cluster, is_thread))
            current_cluster = [tweet]
            is_thread = False

    # Don't forget the last cluster
    if current_cluster:
        clusters.append(_finalize_cluster(current_cluster, is_thread))

    return clusters


def _finalize_cluster(tweets: list[dict], is_thread: bool = False) -> dict:
    """Convert a list of tweets into a cluster event."""
    anchor = tweets[0]
    asset_id = anchor.get("asset_id", "unknown")

    # Generate event_id from asset and anchor tweet
    event_id = f"{asset_id}_{anchor['tweet_id']}"

    # Combine text from all tweets
    combined_text = "\n---\n".join(t["text"] for t in tweets)

    # Calculate time span
    if len(tweets) > 1:
        time_span_seconds = tweets[-1]["timestamp"] - tweets[0]["timestamp"]
    else:
        time_span_seconds = 0

    return {
        "event_id": event_id,
        "asset_id": asset_id,
        "anchor_tweet_id": anchor["tweet_id"],
        "tweet_ids": [t["tweet_id"] for t in tweets],
        "combined_text": combined_text,
        "event_timestamp": anchor["timestamp"],
        "timestamp_iso": anchor.get("timestamp_iso", ""),
        "cluster_size": len(tweets),
        "time_span_seconds": time_span_seconds,
        "is_thread": is_thread,  # True if formed via thread detection (>15min self-reply)
        "tweets": tweets,  # Keep original tweets for reference
    }


def compute_cluster_metrics(raw_count: int, clusters: list[dict]) -> dict:
    """Compute metrics for clustering results."""
    cluster_sizes = [c["cluster_size"] for c in clusters]

    if not cluster_sizes:
        return {
            "raw_tweet_count": raw_count,
            "cluster_event_count": 0,
            "reduction_ratio": 0,
            "cluster_size_distribution": {
                "p50": 0,
                "p90": 0,
                "p99": 0,
                "max": 0,
            },
            "singleton_pct": 0,
            "multi_tweet_pct": 0,
            "thread_clusters": 0,
        }

    singletons = sum(1 for s in cluster_sizes if s == 1)
    multi_tweet = len(cluster_sizes) - singletons
    thread_clusters = sum(1 for c in clusters if c.get("is_thread", False))

    # Percentiles
    sorted_sizes = sorted(cluster_sizes)
    p50_idx = int(len(sorted_sizes) * 0.50)
    p90_idx = int(len(sorted_sizes) * 0.90)
    p99_idx = int(len(sorted_sizes) * 0.99)

    return {
        "raw_tweet_count": raw_count,
        "cluster_event_count": len(clusters),
        "reduction_ratio": round(1 - len(clusters) / raw_count, 2) if raw_count > 0 else 0,
        "cluster_size_distribution": {
            "p50": sorted_sizes[p50_idx] if sorted_sizes else 0,
            "p90": sorted_sizes[min(p90_idx, len(sorted_sizes)-1)] if sorted_sizes else 0,
            "p99": sorted_sizes[min(p99_idx, len(sorted_sizes)-1)] if sorted_sizes else 0,
            "max": max(cluster_sizes) if cluster_sizes else 0,
        },
        "singleton_pct": round(singletons / len(clusters) * 100, 1) if clusters else 0,
        "multi_tweet_pct": round(multi_tweet / len(clusters) * 100, 1) if clusters else 0,
        "thread_clusters": thread_clusters,  # Clusters formed via thread detection
    }


def get_example_clusters(clusters: list[dict], count: int = 10) -> list[dict]:
    """Get example clusters for human review, prioritizing multi-tweet clusters."""
    # Sort by cluster size descending, then by timestamp
    sorted_clusters = sorted(clusters, key=lambda c: (-c["cluster_size"], c["event_timestamp"]))

    examples = []
    for cluster in sorted_clusters[:count]:
        example = {
            "cluster_size": cluster["cluster_size"],
            "time_span_seconds": cluster["time_span_seconds"],
            "anchor_timestamp": cluster["timestamp_iso"],
            "tweets": []
        }
        for tweet in cluster["tweets"]:
            example["tweets"].append({
                "timestamp": tweet.get("timestamp_iso", ""),
                "text": tweet["text"][:200] + ("..." if len(tweet["text"]) > 200 else ""),
            })
        examples.append(example)

    return examples


def generate_metrics_json(all_metrics: dict) -> dict:
    """Generate machine-readable metrics JSON."""
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "window_minutes": CLUSTER_WINDOW_SECONDS // 60,
        "assets": all_metrics,
        "overall": {
            "raw_tweet_count": sum(m["raw_tweet_count"] for m in all_metrics.values()),
            "cluster_event_count": sum(m["cluster_event_count"] for m in all_metrics.values()),
            "reduction_ratio": round(
                1 - sum(m["cluster_event_count"] for m in all_metrics.values()) /
                max(1, sum(m["raw_tweet_count"] for m in all_metrics.values())), 2
            ),
        }
    }


def generate_metrics_markdown(all_metrics: dict, examples: dict) -> str:
    """Generate human-readable metrics markdown."""
    lines = [
        "# Clustering Metrics",
        "",
        f"**Generated:** {datetime.utcnow().isoformat()}Z",
        f"**Window:** {CLUSTER_WINDOW_SECONDS // 60} minutes",
        "",
        "## Summary",
        "",
        "| Asset | Raw Tweets | Events | Reduction | Singletons | Multi-tweet |",
        "|-------|------------|--------|-----------|------------|-------------|",
    ]

    total_raw = 0
    total_events = 0

    for asset_id, metrics in sorted(all_metrics.items()):
        total_raw += metrics["raw_tweet_count"]
        total_events += metrics["cluster_event_count"]
        reduction_pct = int(metrics["reduction_ratio"] * 100)
        lines.append(
            f"| {asset_id.upper()} | {metrics['raw_tweet_count']} | {metrics['cluster_event_count']} | "
            f"{reduction_pct}% | {metrics['singleton_pct']:.0f}% | {metrics['multi_tweet_pct']:.0f}% |"
        )

    # Total row
    total_reduction = int((1 - total_events / max(1, total_raw)) * 100)
    lines.append(f"| **TOTAL** | {total_raw} | {total_events} | {total_reduction}% | - | - |")

    lines.extend([
        "",
        "## Cluster Size Distribution",
        "",
        "| Asset | p50 | p90 | p99 | max |",
        "|-------|-----|-----|-----|-----|",
    ])

    for asset_id, metrics in sorted(all_metrics.items()):
        dist = metrics["cluster_size_distribution"]
        lines.append(f"| {asset_id.upper()} | {dist['p50']} | {dist['p90']} | {dist['p99']} | {dist['max']} |")

    # Example clusters
    lines.extend([
        "",
        "## Example Clusters",
        "",
    ])

    for asset_id, asset_examples in examples.items():
        lines.append(f"### {asset_id.upper()}")
        lines.append("")

        for i, example in enumerate(asset_examples, 1):
            span_str = f"{example['time_span_seconds']}s span" if example['time_span_seconds'] > 0 else "single tweet"
            lines.append(f"**Cluster #{i}** ({example['cluster_size']} tweets, {span_str})")
            lines.append("")
            for tweet in example["tweets"]:
                # Escape any pipe characters in text
                text = tweet["text"].replace("|", "\\|").replace("\n", " ")
                lines.append(f"- `{tweet['timestamp']}`: {text}")
            lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Cluster tweets into events")
    parser.add_argument("--asset", action="append", dest="assets", help="Asset IDs to process")
    parser.add_argument("--all", action="store_true", help="Process all assets")
    parser.add_argument("--use-db", action="store_true", help="Load from DuckDB (includes reply_to for thread detection)")
    parser.add_argument("--examples", type=int, default=5, help="Number of example clusters per asset")
    args = parser.parse_args()

    # Determine which assets to process
    if args.all:
        if args.use_db:
            # Get assets from database
            import duckdb
            conn = duckdb.connect(str(DATA_DIR / "analytics.duckdb"), read_only=True)
            assets = [row[0] for row in conn.execute("SELECT id FROM assets WHERE enabled = TRUE").fetchall()]
            conn.close()
        else:
            # Find all assets with tweet_events.json
            assets = [p.parent.name for p in STATIC_DIR.glob("*/tweet_events.json")]
    elif args.assets:
        assets = args.assets
    else:
        # Default to pump and wif for Phase A validation
        assets = ["pump", "wif"]

    print(f"Processing assets: {', '.join(assets)}")
    print(f"Cluster window: {CLUSTER_WINDOW_SECONDS // 60} minutes")
    print(f"Thread max gap: {THREAD_MAX_GAP_SECONDS // 3600} hours")
    print(f"Data source: {'DuckDB' if args.use_db else 'Static JSON'}")
    print()

    all_metrics = {}
    all_examples = {}
    all_clusters = {}

    for asset_id in assets:
        print(f"Processing {asset_id}...")
        try:
            tweets = load_tweet_events(asset_id, use_db=args.use_db)
            print(f"  Loaded {len(tweets)} tweets")

            clusters = cluster_tweets(tweets)
            print(f"  Clustered into {len(clusters)} events")

            metrics = compute_cluster_metrics(len(tweets), clusters)
            all_metrics[asset_id] = metrics
            all_clusters[asset_id] = clusters

            # Get examples (prioritize multi-tweet clusters)
            examples = get_example_clusters(clusters, count=args.examples)
            all_examples[asset_id] = examples

            multi_tweet_clusters = [c for c in clusters if c["cluster_size"] > 1]
            thread_clusters = metrics.get("thread_clusters", 0)
            print(f"  Multi-tweet clusters: {len(multi_tweet_clusters)}")
            if thread_clusters > 0:
                print(f"  Thread-detected clusters: {thread_clusters}")
            print(f"  Reduction: {int(metrics['reduction_ratio'] * 100)}%")
            print()

        except Exception as e:
            print(f"  Error: {e}")
            import traceback
            traceback.print_exc()
            print()

    # Generate output files
    ANALYSIS_DIR.mkdir(exist_ok=True)

    # JSON metrics
    metrics_json = generate_metrics_json(all_metrics)
    json_path = ANALYSIS_DIR / "cluster_metrics.json"
    with open(json_path, "w") as f:
        json.dump(metrics_json, f, indent=2)
    print(f"Wrote {json_path}")

    # Markdown metrics
    metrics_md = generate_metrics_markdown(all_metrics, all_examples)
    md_path = ANALYSIS_DIR / "cluster_metrics.md"
    with open(md_path, "w") as f:
        f.write(metrics_md)
    print(f"Wrote {md_path}")

    print()
    print("=" * 60)
    print("STOP GATE: Review cluster_metrics.md before proceeding")
    print("=" * 60)


if __name__ == "__main__":
    main()
