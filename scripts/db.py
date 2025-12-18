"""
DuckDB database management for tweet-price analytics.
Single source of truth for all assets, tweets, and price data.

v2.0 Changes:
- Added data_source tracking for prices (provenance)
- Added token_mint column to assets
- Optimized tweet_events with pre-computed price lookups
- Added gap detection and data quality views
"""
import json
import duckdb
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

# Paths
SCRIPTS_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPTS_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
ASSETS_FILE = SCRIPTS_DIR / "assets.json"
ANALYTICS_DB = DATA_DIR / "analytics.duckdb"


def get_connection(db_path: Path = ANALYTICS_DB) -> duckdb.DuckDBPyConnection:
    """Get a DuckDB connection with WAL mode enabled."""
    DATA_DIR.mkdir(exist_ok=True)
    conn = duckdb.connect(str(db_path))
    return conn


def init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Initialize the database schema."""
    
    # Assets table (v2: added token_mint, backfill_source)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            founder VARCHAR NOT NULL,
            network VARCHAR,
            pool_address VARCHAR,
            token_mint VARCHAR,
            coingecko_id VARCHAR,
            price_source VARCHAR NOT NULL,
            backfill_source VARCHAR,
            launch_date TIMESTAMP NOT NULL,
            color VARCHAR,
            enabled BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT now(),
            updated_at TIMESTAMP DEFAULT now()
        )
    """)
    
    # Add new columns if they don't exist (migration)
    try:
        conn.execute("ALTER TABLE assets ADD COLUMN IF NOT EXISTS token_mint VARCHAR")
        conn.execute("ALTER TABLE assets ADD COLUMN IF NOT EXISTS backfill_source VARCHAR")
    except:
        pass
    
    # Tweets table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tweets (
            id VARCHAR PRIMARY KEY,
            asset_id VARCHAR NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            text VARCHAR,
            likes INTEGER DEFAULT 0,
            retweets INTEGER DEFAULT 0,
            replies INTEGER DEFAULT 0,
            impressions INTEGER DEFAULT 0,
            fetched_at TIMESTAMP DEFAULT now(),
            FOREIGN KEY (asset_id) REFERENCES assets(id)
        )
    """)
    
    # Prices table (v2: added data_source for provenance tracking)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prices (
            asset_id VARCHAR NOT NULL,
            timeframe VARCHAR NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE,
            data_source VARCHAR DEFAULT 'unknown',
            fetched_at TIMESTAMP DEFAULT now(),
            PRIMARY KEY (asset_id, timeframe, timestamp),
            FOREIGN KEY (asset_id) REFERENCES assets(id)
        )
    """)
    
    # Add data_source column if it doesn't exist (migration)
    try:
        conn.execute("ALTER TABLE prices ADD COLUMN IF NOT EXISTS data_source VARCHAR DEFAULT 'unknown'")
    except:
        pass
    
    # Ingestion state for incremental fetching
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ingestion_state (
            asset_id VARCHAR NOT NULL,
            data_type VARCHAR NOT NULL,
            last_id VARCHAR,
            last_timestamp TIMESTAMP,
            updated_at TIMESTAMP DEFAULT now(),
            PRIMARY KEY (asset_id, data_type),
            FOREIGN KEY (asset_id) REFERENCES assets(id)
        )
    """)
    
    # Create indexes for performance
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_tweets_asset_ts 
        ON tweets(asset_id, timestamp)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_tweets_asset 
        ON tweets(asset_id)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_prices_asset_tf_ts 
        ON prices(asset_id, timeframe, timestamp)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_prices_source 
        ON prices(data_source)
    """)
    
    # Create optimized tweet_events view with timeframe fallback
    # Uses 1m data if available, falls back to 1h, then 1d
    # IMPORTANT: Each timeframe has a staleness limit to prevent using stale data:
    #   - 1m: max 1 hour old (prevents old 1m data from overriding fresh 1h/1d)
    #   - 1h: max 24 hours old
    #   - 1d: max 7 days old
    conn.execute("""
        CREATE OR REPLACE VIEW tweet_events AS
        WITH tweet_base AS (
            SELECT 
                t.id AS tweet_id,
                t.asset_id,
                a.name AS asset_name,
                a.founder,
                a.color AS asset_color,
                t.timestamp,
                t.text,
                t.likes,
                t.retweets,
                t.replies,
                t.impressions
            FROM tweets t
            JOIN assets a ON t.asset_id = a.id
            WHERE a.enabled = true
              AND t.timestamp >= a.launch_date
        ),
        -- Get best available price at tweet time (prefer 1m > 1h > 1d)
        -- Only use data if fresh enough for its timeframe
        price_at_tweet AS (
            SELECT DISTINCT ON (tb.tweet_id)
                tb.tweet_id,
                p.close AS price_at_tweet
            FROM tweet_base tb
            LEFT JOIN prices p ON p.asset_id = tb.asset_id 
                AND p.timestamp <= tb.timestamp
                AND (
                    (p.timeframe = '1m' AND tb.timestamp - p.timestamp <= INTERVAL '1 hour')
                    OR (p.timeframe = '1h' AND tb.timestamp - p.timestamp <= INTERVAL '24 hours')
                    OR (p.timeframe = '1d' AND tb.timestamp - p.timestamp <= INTERVAL '7 days')
                )
            ORDER BY tb.tweet_id, 
                CASE p.timeframe WHEN '1m' THEN 1 WHEN '1h' THEN 2 WHEN '1d' THEN 3 END,
                p.timestamp DESC
        ),
        -- Get price 1 hour later (with same staleness checks)
        price_1h AS (
            SELECT DISTINCT ON (tb.tweet_id)
                tb.tweet_id,
                p.close AS price_1h
            FROM tweet_base tb
            LEFT JOIN prices p ON p.asset_id = tb.asset_id 
                AND p.timestamp <= tb.timestamp + INTERVAL '1 hour'
                AND (
                    (p.timeframe = '1m' AND (tb.timestamp + INTERVAL '1 hour') - p.timestamp <= INTERVAL '1 hour')
                    OR (p.timeframe = '1h' AND (tb.timestamp + INTERVAL '1 hour') - p.timestamp <= INTERVAL '24 hours')
                    OR (p.timeframe = '1d' AND (tb.timestamp + INTERVAL '1 hour') - p.timestamp <= INTERVAL '7 days')
                )
            ORDER BY tb.tweet_id,
                CASE p.timeframe WHEN '1m' THEN 1 WHEN '1h' THEN 2 WHEN '1d' THEN 3 END,
                p.timestamp DESC
        ),
        -- Get price 24 hours later (with same staleness checks)
        price_24h AS (
            SELECT DISTINCT ON (tb.tweet_id)
                tb.tweet_id,
                p.close AS price_24h
            FROM tweet_base tb
            LEFT JOIN prices p ON p.asset_id = tb.asset_id 
                AND p.timestamp <= tb.timestamp + INTERVAL '24 hours'
                AND (
                    (p.timeframe = '1m' AND (tb.timestamp + INTERVAL '24 hours') - p.timestamp <= INTERVAL '1 hour')
                    OR (p.timeframe = '1h' AND (tb.timestamp + INTERVAL '24 hours') - p.timestamp <= INTERVAL '24 hours')
                    OR (p.timeframe = '1d' AND (tb.timestamp + INTERVAL '24 hours') - p.timestamp <= INTERVAL '7 days')
                )
            ORDER BY tb.tweet_id,
                CASE p.timeframe WHEN '1m' THEN 1 WHEN '1h' THEN 2 WHEN '1d' THEN 3 END,
                p.timestamp DESC
        )
        SELECT 
            tb.*,
            pat.price_at_tweet,
            p1h.price_1h,
            p24h.price_24h
        FROM tweet_base tb
        LEFT JOIN price_at_tweet pat ON tb.tweet_id = pat.tweet_id
        LEFT JOIN price_1h p1h ON tb.tweet_id = p1h.tweet_id
        LEFT JOIN price_24h p24h ON tb.tweet_id = p24h.tweet_id
        ORDER BY tb.timestamp
    """)
    
    # Fallback view using daily prices for assets without 1m data
    conn.execute("""
        CREATE OR REPLACE VIEW tweet_events_daily AS
        SELECT 
            t.id AS tweet_id,
            t.asset_id,
            a.name AS asset_name,
            a.founder,
            a.color AS asset_color,
            t.timestamp,
            t.text,
            t.likes,
            t.retweets,
            t.replies,
            t.impressions,
            -- Price at tweet time (find closest 1d candle)
            (SELECT p.close 
             FROM prices p 
             WHERE p.asset_id = t.asset_id 
               AND p.timeframe = '1d'
               AND p.timestamp <= t.timestamp
             ORDER BY p.timestamp DESC 
             LIMIT 1) AS price_at_tweet,
            -- Price 1 day later (approximate 1h as same-day)
            (SELECT p.close 
             FROM prices p 
             WHERE p.asset_id = t.asset_id 
               AND p.timeframe = '1d'
               AND p.timestamp <= t.timestamp + INTERVAL '1 day'
             ORDER BY p.timestamp DESC 
             LIMIT 1) AS price_1h,
            -- Price 1 day later
            (SELECT p.close 
             FROM prices p 
             WHERE p.asset_id = t.asset_id 
               AND p.timeframe = '1d'
               AND p.timestamp <= t.timestamp + INTERVAL '1 day'
             ORDER BY p.timestamp DESC 
             LIMIT 1) AS price_24h
        FROM tweets t
        JOIN assets a ON t.asset_id = a.id
        WHERE a.enabled = true
          AND t.timestamp >= a.launch_date
        ORDER BY t.timestamp
    """)
    
    # Data quality view: detect gaps in price data
    conn.execute("""
        CREATE OR REPLACE VIEW price_gaps AS
        WITH price_with_prev AS (
            SELECT 
                asset_id,
                timeframe,
                timestamp,
                LAG(timestamp) OVER (
                    PARTITION BY asset_id, timeframe 
                    ORDER BY timestamp
                ) AS prev_timestamp
            FROM prices
        ),
        expected_intervals AS (
            SELECT 
                asset_id,
                timeframe,
                timestamp,
                prev_timestamp,
                CASE timeframe
                    WHEN '1m' THEN 60
                    WHEN '15m' THEN 900
                    WHEN '1h' THEN 3600
                    WHEN '1d' THEN 86400
                END AS expected_seconds
            FROM price_with_prev
            WHERE prev_timestamp IS NOT NULL
        )
        SELECT 
            asset_id,
            timeframe,
            prev_timestamp AS gap_start,
            timestamp AS gap_end,
            EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) AS actual_seconds,
            expected_seconds,
            EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) / expected_seconds AS missing_candles
        FROM expected_intervals
        WHERE EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) > expected_seconds * 2
        ORDER BY asset_id, timeframe, gap_start
    """)
    
    # Data source summary view
    conn.execute("""
        CREATE OR REPLACE VIEW data_source_summary AS
        SELECT 
            asset_id,
            timeframe,
            data_source,
            COUNT(*) AS candle_count,
            MIN(timestamp) AS earliest,
            MAX(timestamp) AS latest
        FROM prices
        GROUP BY asset_id, timeframe, data_source
        ORDER BY asset_id, timeframe, data_source
    """)


def load_assets_from_json(conn: duckdb.DuckDBPyConnection, assets_file: Path = ASSETS_FILE) -> int:
    """
    Load/sync assets from JSON config into database.
    Returns number of assets upserted.
    """
    with open(assets_file) as f:
        config = json.load(f)
    
    count = 0
    for asset in config.get("assets", []):
        conn.execute("""
            INSERT INTO assets (id, name, founder, network, pool_address, token_mint,
                               coingecko_id, price_source, backfill_source, launch_date, 
                               color, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                founder = EXCLUDED.founder,
                network = EXCLUDED.network,
                pool_address = EXCLUDED.pool_address,
                token_mint = EXCLUDED.token_mint,
                coingecko_id = EXCLUDED.coingecko_id,
                price_source = EXCLUDED.price_source,
                backfill_source = EXCLUDED.backfill_source,
                launch_date = EXCLUDED.launch_date,
                color = EXCLUDED.color,
                enabled = EXCLUDED.enabled,
                updated_at = now()
        """, [
            asset["id"],
            asset["name"],
            asset["founder"],
            asset.get("network"),
            asset.get("pool_address"),
            asset.get("token_mint"),
            asset.get("coingecko_id"),
            asset["price_source"],
            asset.get("backfill_source"),
            asset["launch_date"],
            asset.get("color"),
            asset.get("enabled", True),
        ])
        count += 1
    
    return count


def get_asset(conn: duckdb.DuckDBPyConnection, asset_id: str) -> Optional[Dict[str, Any]]:
    """Get a single asset by ID."""
    result = conn.execute("""
        SELECT id, name, founder, network, pool_address, token_mint, coingecko_id,
               price_source, backfill_source, launch_date, color, enabled
        FROM assets WHERE id = ?
    """, [asset_id]).fetchone()
    
    if not result:
        return None
    
    return {
        "id": result[0],
        "name": result[1],
        "founder": result[2],
        "network": result[3],
        "pool_address": result[4],
        "token_mint": result[5],
        "coingecko_id": result[6],
        "price_source": result[7],
        "backfill_source": result[8],
        "launch_date": result[9],
        "color": result[10],
        "enabled": result[11],
    }


def get_enabled_assets(conn: duckdb.DuckDBPyConnection) -> List[Dict[str, Any]]:
    """Get all enabled assets."""
    results = conn.execute("""
        SELECT id, name, founder, network, pool_address, token_mint, coingecko_id,
               price_source, backfill_source, launch_date, color, enabled
        FROM assets WHERE enabled = true
        ORDER BY name
    """).fetchall()
    
    return [
        {
            "id": r[0],
            "name": r[1],
            "founder": r[2],
            "network": r[3],
            "pool_address": r[4],
            "token_mint": r[5],
            "coingecko_id": r[6],
            "price_source": r[7],
            "backfill_source": r[8],
            "launch_date": r[9],
            "color": r[10],
            "enabled": r[11],
        }
        for r in results
    ]


def get_all_assets(conn: duckdb.DuckDBPyConnection) -> List[Dict[str, Any]]:
    """Get all assets (including disabled)."""
    results = conn.execute("""
        SELECT id, name, founder, network, pool_address, token_mint, coingecko_id,
               price_source, backfill_source, launch_date, color, enabled
        FROM assets
        ORDER BY name
    """).fetchall()
    
    return [
        {
            "id": r[0],
            "name": r[1],
            "founder": r[2],
            "network": r[3],
            "pool_address": r[4],
            "token_mint": r[5],
            "coingecko_id": r[6],
            "price_source": r[7],
            "backfill_source": r[8],
            "launch_date": r[9],
            "color": r[10],
            "enabled": r[11],
        }
        for r in results
    ]


def get_ingestion_state(
    conn: duckdb.DuckDBPyConnection, 
    asset_id: str, 
    data_type: str
) -> Optional[Dict[str, Any]]:
    """Get ingestion state for an asset/data_type combo."""
    result = conn.execute("""
        SELECT last_id, last_timestamp, updated_at
        FROM ingestion_state
        WHERE asset_id = ? AND data_type = ?
    """, [asset_id, data_type]).fetchone()
    
    if not result:
        return None
    
    return {
        "last_id": result[0],
        "last_timestamp": result[1],
        "updated_at": result[2],
    }


def update_ingestion_state(
    conn: duckdb.DuckDBPyConnection,
    asset_id: str,
    data_type: str,
    last_id: Optional[str] = None,
    last_timestamp: Optional[datetime] = None
) -> None:
    """Update ingestion state after a successful fetch."""
    conn.execute("""
        INSERT INTO ingestion_state (asset_id, data_type, last_id, last_timestamp, updated_at)
        VALUES (?, ?, ?, ?, now())
        ON CONFLICT (asset_id, data_type) DO UPDATE SET
            last_id = COALESCE(EXCLUDED.last_id, ingestion_state.last_id),
            last_timestamp = COALESCE(EXCLUDED.last_timestamp, ingestion_state.last_timestamp),
            updated_at = now()
    """, [asset_id, data_type, last_id, last_timestamp])


def insert_tweets(
    conn: duckdb.DuckDBPyConnection,
    asset_id: str,
    tweets: List[Dict[str, Any]]
) -> int:
    """
    Insert tweets into database. Uses INSERT OR IGNORE for deduplication.
    Returns number of tweets inserted.
    """
    if not tweets:
        return 0
    
    inserted = 0
    for tweet in tweets:
        try:
            conn.execute("""
                INSERT INTO tweets (id, asset_id, timestamp, text, likes, retweets, replies, impressions, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (id) DO UPDATE SET
                    likes = EXCLUDED.likes,
                    retweets = EXCLUDED.retweets,
                    replies = EXCLUDED.replies,
                    impressions = EXCLUDED.impressions,
                    fetched_at = now()
            """, [
                tweet["id"],
                asset_id,
                tweet["timestamp"] if isinstance(tweet.get("timestamp"), datetime) else tweet.get("created_at"),
                tweet.get("text"),
                tweet.get("likes", 0),
                tweet.get("retweets", 0),
                tweet.get("replies", 0),
                tweet.get("impressions", 0),
            ])
            inserted += 1
        except Exception as e:
            print(f"Error inserting tweet {tweet.get('id')}: {e}")
    
    return inserted


def insert_prices(
    conn: duckdb.DuckDBPyConnection,
    asset_id: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    data_source: str = "unknown"
) -> int:
    """
    Insert price candles into database.
    Returns number of candles inserted.
    
    Args:
        conn: Database connection
        asset_id: Asset identifier
        timeframe: Timeframe (1m, 15m, 1h, 1d)
        candles: List of candle dicts with timestamp_epoch, open, high, low, close, volume
        data_source: Source of data (geckoterminal, birdeye, hyperliquid, coingecko)
    """
    if not candles:
        return 0
    
    # Prepare data for bulk insert
    data = [
        (
            asset_id,
            timeframe,
            datetime.utcfromtimestamp(c["timestamp_epoch"]) if "timestamp_epoch" in c else c["timestamp"],
            c.get("open"),
            c.get("high"),
            c.get("low"),
            c.get("close"),
            c.get("volume"),
            data_source,
        )
        for c in candles
    ]
    
    conn.executemany("""
        INSERT INTO prices (asset_id, timeframe, timestamp, open, high, low, close, volume, data_source, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())
        ON CONFLICT (asset_id, timeframe, timestamp) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            data_source = EXCLUDED.data_source,
            fetched_at = now()
    """, data)
    
    return len(data)


def get_tweet_events(
    conn: duckdb.DuckDBPyConnection,
    asset_id: Optional[str] = None,
    use_daily_fallback: bool = False
) -> List[Dict[str, Any]]:
    """
    Get aligned tweet events from the view.
    Optionally filter by asset_id.
    use_daily_fallback uses 1d prices for assets without 1m data.
    """
    view_name = "tweet_events_daily" if use_daily_fallback else "tweet_events"
    
    if asset_id:
        results = conn.execute(f"""
            SELECT tweet_id, asset_id, asset_name, founder, asset_color,
                   timestamp, text, likes, retweets, replies, impressions,
                   price_at_tweet, price_1h, price_24h
            FROM {view_name}
            WHERE asset_id = ?
            ORDER BY timestamp
        """, [asset_id]).fetchall()
    else:
        results = conn.execute(f"""
            SELECT tweet_id, asset_id, asset_name, founder, asset_color,
                   timestamp, text, likes, retweets, replies, impressions,
                   price_at_tweet, price_1h, price_24h
            FROM {view_name}
            ORDER BY timestamp
        """).fetchall()
    
    events = []
    for r in results:
        price_at = r[11]
        price_1h = r[12]
        price_24h = r[13]
        
        change_1h = None
        change_24h = None
        if price_at and price_1h:
            change_1h = round((price_1h - price_at) / price_at * 100, 2)
        if price_at and price_24h:
            change_24h = round((price_24h - price_at) / price_at * 100, 2)
        
        events.append({
            "tweet_id": r[0],
            "asset_id": r[1],
            "asset_name": r[2],
            "founder": r[3],
            "asset_color": r[4],
            "timestamp": int(r[5].timestamp()) if hasattr(r[5], 'timestamp') else r[5],
            "timestamp_iso": r[5].isoformat() + "Z" if hasattr(r[5], 'isoformat') else str(r[5]),
            "text": r[6],
            "likes": r[7],
            "retweets": r[8],
            "replies": r[9],
            "impressions": r[10],
            "price_at_tweet": price_at,
            "price_1h": price_1h,
            "price_24h": price_24h,
            "change_1h_pct": change_1h,
            "change_24h_pct": change_24h,
        })
    
    return events


def get_price_gaps(
    conn: duckdb.DuckDBPyConnection,
    asset_id: Optional[str] = None,
    timeframe: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Get gaps in price data for quality monitoring.
    
    Args:
        asset_id: Filter by asset (optional)
        timeframe: Filter by timeframe (optional)
    
    Returns list of gaps with start, end, and missing candle count.
    """
    query = "SELECT * FROM price_gaps WHERE 1=1"
    params = []
    
    if asset_id:
        query += " AND asset_id = ?"
        params.append(asset_id)
    if timeframe:
        query += " AND timeframe = ?"
        params.append(timeframe)
    
    query += " ORDER BY asset_id, timeframe, gap_start"
    
    results = conn.execute(query, params).fetchall()
    
    return [
        {
            "asset_id": r[0],
            "timeframe": r[1],
            "gap_start": r[2].isoformat() if hasattr(r[2], 'isoformat') else r[2],
            "gap_end": r[3].isoformat() if hasattr(r[3], 'isoformat') else r[3],
            "actual_seconds": r[4],
            "expected_seconds": r[5],
            "missing_candles": int(r[6]) if r[6] else 0,
        }
        for r in results
    ]


def get_data_source_summary(conn: duckdb.DuckDBPyConnection) -> Dict[str, Any]:
    """Get summary of data sources used for each asset/timeframe."""
    results = conn.execute("SELECT * FROM data_source_summary").fetchall()
    
    summary = {}
    for r in results:
        asset_id, timeframe, data_source, count, earliest, latest = r
        
        if asset_id not in summary:
            summary[asset_id] = {}
        if timeframe not in summary[asset_id]:
            summary[asset_id][timeframe] = {}
        
        summary[asset_id][timeframe][data_source] = {
            "count": count,
            "earliest": earliest.isoformat() if earliest else None,
            "latest": latest.isoformat() if latest else None,
        }
    
    return summary


def get_db_stats(conn: duckdb.DuckDBPyConnection) -> Dict[str, Any]:
    """Get overall database statistics."""
    stats = {}
    
    # Asset counts
    stats["assets"] = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
    stats["enabled_assets"] = conn.execute("SELECT COUNT(*) FROM assets WHERE enabled = true").fetchone()[0]
    
    # Tweet counts per asset
    tweet_counts = conn.execute("""
        SELECT a.id, a.name, COUNT(t.id) as tweet_count
        FROM assets a
        LEFT JOIN tweets t ON a.id = t.asset_id
        GROUP BY a.id, a.name
        ORDER BY a.name
    """).fetchall()
    stats["tweets_by_asset"] = {r[0]: {"name": r[1], "count": r[2]} for r in tweet_counts}
    
    # Price data ranges per asset
    price_ranges = conn.execute("""
        SELECT a.id, a.name, p.timeframe, 
               MIN(p.timestamp) as start_date,
               MAX(p.timestamp) as end_date,
               COUNT(*) as candle_count
        FROM assets a
        LEFT JOIN prices p ON a.id = p.asset_id
        WHERE p.timestamp IS NOT NULL
        GROUP BY a.id, a.name, p.timeframe
        ORDER BY a.name, p.timeframe
    """).fetchall()
    
    stats["prices_by_asset"] = {}
    for r in price_ranges:
        asset_id = r[0]
        if asset_id not in stats["prices_by_asset"]:
            stats["prices_by_asset"][asset_id] = {"name": r[1], "timeframes": {}}
        stats["prices_by_asset"][asset_id]["timeframes"][r[2]] = {
            "start": r[3].isoformat() if r[3] else None,
            "end": r[4].isoformat() if r[4] else None,
            "count": r[5],
        }
    
    # Data source summary
    stats["data_sources"] = get_data_source_summary(conn)
    
    # Gap summary
    gap_summary = conn.execute("""
        SELECT asset_id, timeframe, COUNT(*) as gap_count, SUM(missing_candles) as total_missing
        FROM price_gaps
        GROUP BY asset_id, timeframe
    """).fetchall()
    stats["gaps"] = {
        f"{r[0]}_{r[1]}": {"gap_count": r[2], "total_missing": int(r[3]) if r[3] else 0}
        for r in gap_summary
    }
    
    return stats


def init_db(db_path: Path = ANALYTICS_DB) -> duckdb.DuckDBPyConnection:
    """Initialize database with schema and load assets from JSON."""
    conn = get_connection(db_path)
    init_schema(conn)
    load_assets_from_json(conn)
    return conn


# CLI interface
def main():
    """CLI for database management."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python db.py <command>")
        print("Commands:")
        print("  init          - Initialize database schema")
        print("  sync-assets   - Sync assets from JSON to database")
        print("  stats         - Show database statistics")
        print("  list-assets   - List all assets")
        print("  gaps          - Show price data gaps")
        print("  sources       - Show data source summary")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "init":
        print("Initializing database...")
        conn = get_connection()
        init_schema(conn)
        count = load_assets_from_json(conn)
        print(f"Database initialized at {ANALYTICS_DB}")
        print(f"Loaded {count} assets from {ASSETS_FILE}")
        conn.close()
    
    elif command == "sync-assets":
        print("Syncing assets from JSON...")
        conn = get_connection()
        init_schema(conn)
        count = load_assets_from_json(conn)
        print(f"Synced {count} assets")
        conn.close()
    
    elif command == "stats":
        conn = get_connection()
        init_schema(conn)
        stats = get_db_stats(conn)
        print(f"\nDatabase: {ANALYTICS_DB}")
        print(f"Total assets: {stats['assets']} ({stats['enabled_assets']} enabled)")
        print("\nTweets by asset:")
        for asset_id, info in stats.get("tweets_by_asset", {}).items():
            print(f"  {info['name']}: {info['count']:,} tweets")
        print("\nPrice data by asset:")
        for asset_id, info in stats.get("prices_by_asset", {}).items():
            print(f"  {info['name']}:")
            for tf, tf_info in info.get("timeframes", {}).items():
                print(f"    {tf}: {tf_info['count']:,} candles ({tf_info['start'][:10] if tf_info['start'] else 'N/A'} to {tf_info['end'][:10] if tf_info['end'] else 'N/A'})")
        conn.close()
    
    elif command == "list-assets":
        conn = get_connection()
        init_schema(conn)
        assets = get_all_assets(conn)
        print(f"\n{'ID':<12} {'Name':<12} {'Founder':<18} {'Network':<12} {'Source':<14} {'Backfill':<10} {'Enabled'}")
        print("-" * 100)
        for a in assets:
            enabled = "✓" if a["enabled"] else "✗"
            backfill = a.get("backfill_source") or "-"
            print(f"{a['id']:<12} {a['name']:<12} {a['founder']:<18} {a['network'] or 'N/A':<12} {a['price_source']:<14} {backfill:<10} {enabled}")
        conn.close()
    
    elif command == "gaps":
        conn = get_connection()
        init_schema(conn)
        gaps = get_price_gaps(conn)
        if not gaps:
            print("No gaps detected in price data!")
        else:
            print(f"\nDetected {len(gaps)} gaps in price data:")
            for g in gaps[:20]:  # Show first 20
                print(f"  {g['asset_id']}/{g['timeframe']}: {g['gap_start'][:19]} → {g['gap_end'][:19]} ({g['missing_candles']} missing)")
            if len(gaps) > 20:
                print(f"  ... and {len(gaps) - 20} more")
        conn.close()
    
    elif command == "sources":
        conn = get_connection()
        init_schema(conn)
        summary = get_data_source_summary(conn)
        print("\nData source summary:")
        for asset_id, timeframes in summary.items():
            print(f"\n  {asset_id}:")
            for tf, sources in timeframes.items():
                for source, info in sources.items():
                    print(f"    {tf}/{source}: {info['count']:,} candles")
        conn.close()
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
