"""
Fetch multi-timeframe price data from multiple sources.
Store in unified DuckDB database with data provenance tracking.

Supported Sources:
- GeckoTerminal: DEX pools (Solana, BSC, ETH) - 180 day limit on free tier
- Birdeye: Solana tokens - FULL historical access with API key
- CoinGecko: Listed tokens - daily OHLC only
- Hyperliquid: HYPE perp/spot - limited retention

Strategy:
1. Use primary source (price_source) for recent/ongoing data
2. Use backfill_source (birdeye) to fill historical gaps
3. Track data_source for each candle for provenance

Usage:
    python fetch_prices.py                      # Fetch all enabled assets
    python fetch_prices.py --asset pump         # Fetch specific asset
    python fetch_prices.py --asset jup --backfill  # Backfill from Birdeye
    python fetch_prices.py --gaps               # Show data gaps
"""
import argparse
import calendar
import httpx
import time
import os
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

from config import TIMEFRAMES, TIMEFRAME_TO_GT, DATA_DIR
from db import (
    get_connection, init_schema, get_asset, get_enabled_assets,
    get_ingestion_state, update_ingestion_state, insert_prices,
    get_price_gaps, load_assets_from_json
)

# API endpoints
GT_API = "https://api.geckoterminal.com/api/v2"
CG_API = "https://api.coingecko.com/api/v3"
HL_API = "https://api.hyperliquid.xyz/info"
BE_API = "https://public-api.birdeye.so"

# Birdeye API key from environment (required for Solana historical data)
BIRDEYE_API_KEY = os.getenv("BIRDEYE_API_KEY")

MAX_CANDLES_PER_REQUEST = 1000
HL_MAX_CANDLES = 5000  # Hyperliquid limit
BE_MAX_CANDLES = 1000  # Birdeye limit
RATE_LIMIT_DELAY = 0.5  # Be nice to the APIs

# Outlier detection defaults
# WHY 5-SIGMA: Crypto has fat tails. 3-sigma flags legitimate pumps. See GOTCHAS.md.
OUTLIER_THRESHOLD_STD = 5  # DO NOT lower without testing on real pump data
OUTLIER_MIN_CANDLES = 20    # Need at least this many candles for detection

# Hyperliquid interval mapping
HL_INTERVALS = {
    "1m": "1m",
    "15m": "15m",
    "1h": "1h",
    "1d": "1d",
}

# Birdeye interval mapping
BE_INTERVALS = {
    "1m": "1m",
    "15m": "15m",
    "1h": "1H",
    "1d": "1D",
}


# =============================================================================
# OUTLIER DETECTION (Sniper Bot Detection)
# =============================================================================

def detect_outliers(
    candles: List[Dict],
    threshold_std: float = OUTLIER_THRESHOLD_STD,
    min_candles: int = OUTLIER_MIN_CANDLES
) -> List[Dict]:
    """
    Detect statistically anomalous candles (likely sniper bot activity).
    
    Sniper bots often create extreme price spikes in the first few minutes
    of a token's trading, resulting in HIGH values that are orders of
    magnitude above the actual trading price.
    
    Args:
        candles: List of candle dicts with 'high', 'timestamp_epoch' keys
        threshold_std: Flag candles where HIGH > median + (threshold_std * std)
        min_candles: Minimum candles needed for statistical detection
    
    Returns:
        List of outlier candle dicts with added 'outlier_reason' field
    """
    if len(candles) < min_candles:
        return []
    
    # Extract HIGH values
    highs = [c["high"] for c in candles if c.get("high") is not None]
    
    if len(highs) < min_candles:
        return []
    
    # Calculate median (more robust than mean for skewed data)
    sorted_highs = sorted(highs)
    n = len(sorted_highs)
    median = sorted_highs[n // 2] if n % 2 else (sorted_highs[n//2 - 1] + sorted_highs[n//2]) / 2
    
    # Calculate standard deviation
    mean = sum(highs) / len(highs)
    variance = sum((h - mean) ** 2 for h in highs) / len(highs)
    std = variance ** 0.5
    
    if std == 0:
        return []
    
    # Threshold: median + (threshold_std * std)
    upper_threshold = median + (threshold_std * std)
    
    # Find outliers
    outliers = []
    for c in candles:
        if c.get("high") is not None and c["high"] > upper_threshold:
            outlier = c.copy()
            outlier["outlier_reason"] = f"HIGH ${c['high']:.4f} > threshold ${upper_threshold:.4f} (median=${median:.4f}, {threshold_std}σ)"
            outlier["outlier_ratio"] = c["high"] / median if median > 0 else float('inf')
            outliers.append(outlier)
    
    return outliers


def warn_outliers(candles: List[Dict], asset_id: str, timeframe: str) -> List[Dict]:
    """
    Detect and LOUDLY warn about outliers. Does NOT remove them.
    
    Returns the detected outliers for logging/reporting.
    """
    outliers = detect_outliers(candles)
    
    if outliers:
        print(f"\n{'!'*60}")
        print(f"WARNING: {len(outliers)} POTENTIAL OUTLIERS DETECTED")
        print(f"Asset: {asset_id}, Timeframe: {timeframe}")
        print(f"{'!'*60}")
        
        for o in outliers[:10]:  # Show first 10
            ts = datetime.utcfromtimestamp(o["timestamp_epoch"]).strftime("%Y-%m-%d %H:%M")
            print(f"  {ts}: HIGH=${o['high']:.4f} ({o['outlier_ratio']:.1f}x median)")
            print(f"         {o['outlier_reason']}")
        
        if len(outliers) > 10:
            print(f"  ... and {len(outliers) - 10} more outliers")
        
        print(f"\nTo clean these outliers, run:")
        print(f"  python db.py cleanup-outliers --asset {asset_id} --timeframe {timeframe}")
        print(f"{'!'*60}\n")
    
    return outliers


def filter_outliers(candles: List[Dict], asset_id: str, timeframe: str) -> List[Dict]:
    """
    Detect outliers and REMOVE them from the candle list.
    
    Logs removed outliers for transparency.
    Returns cleaned candle list with outliers removed.
    """
    outliers = detect_outliers(candles)
    
    if not outliers:
        return candles
    
    # Get timestamps of outliers for filtering
    outlier_timestamps = {o["timestamp_epoch"] for o in outliers}
    
    # Log what we're removing
    print(f"\n[OUTLIER FILTER] Removing {len(outliers)} outlier candles from {asset_id}/{timeframe}:")
    for o in outliers[:5]:  # Show first 5
        ts = datetime.utcfromtimestamp(o["timestamp_epoch"]).strftime("%Y-%m-%d %H:%M")
        print(f"  {ts}: HIGH=${o['high']:.6f} ({o['outlier_ratio']:.1f}x median)")
    if len(outliers) > 5:
        print(f"  ... and {len(outliers) - 5} more")
    
    # Filter out outliers
    cleaned = [c for c in candles if c["timestamp_epoch"] not in outlier_timestamps]
    
    print(f"  Kept {len(cleaned)}/{len(candles)} candles\n")
    
    return cleaned


def fetch_with_retry(fetch_fn, max_retries=5, base_delay=1.0):
    """Execute fetch function with exponential backoff retry."""
    import random
    
    for attempt in range(max_retries):
        try:
            return fetch_fn()
        except Exception as e:
            if "429" in str(e) or "rate" in str(e).lower():
                wait = (2 ** attempt) + random.uniform(0, 1)
                print(f"      Rate limited, waiting {wait:.1f}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
            else:
                raise
    
    raise Exception(f"Max retries ({max_retries}) exceeded")


# =============================================================================
# BIRDEYE FETCHER (NEW)
# =============================================================================

def fetch_birdeye_ohlcv(
    token_mint: str,
    timeframe: str,
    time_from: int,
    time_to: int,
    chain: str = "solana"
) -> List[Dict]:
    """
    Fetch OHLCV data from Birdeye API.
    
    Args:
        token_mint: Token mint address (NOT pool address)
        timeframe: One of '1m', '15m', '1h', '1d'
        time_from: Start timestamp (Unix seconds)
        time_to: End timestamp (Unix seconds)
        chain: Blockchain (default: solana)
    
    Returns list of candles.
    """
    if not BIRDEYE_API_KEY:
        raise ValueError("BIRDEYE_API_KEY environment variable is required for Birdeye API calls")

    be_type = BE_INTERVALS.get(timeframe, "1m")
    url = f"{BE_API}/defi/ohlcv"
    
    params = {
        "address": token_mint,
        "type": be_type,
        "time_from": time_from,
        "time_to": time_to,
    }
    
    headers = {
        "X-API-KEY": BIRDEYE_API_KEY,
        "x-chain": chain,
    }
    
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, params=params, headers=headers)
        
        if response.status_code == 429:
            print("      Rate limited by Birdeye, waiting 60s...")
            time.sleep(60)
            return fetch_birdeye_ohlcv(token_mint, timeframe, time_from, time_to, chain)
        
        if response.status_code != 200:
            print(f"      Birdeye error {response.status_code}: {response.text[:200]}")
            return []
        
        data = response.json()
        items = data.get("data", {}).get("items", [])
        
        if not items:
            return []
        
        candles = []
        for item in items:
            candles.append({
                "timestamp_epoch": int(item["unixTime"]),
                "open": float(item["o"]),
                "high": float(item["h"]),
                "low": float(item["l"]),
                "close": float(item["c"]),
                "volume": float(item["v"]) if item.get("v") else 0.0,
            })
        
        return candles


def fetch_birdeye_all_timeframes(
    token_mint: str,
    launch_timestamp: int,
    timeframes: List[str] = None,
    chain: str = "solana"
) -> Dict[str, List[Dict]]:
    """
    Fetch all timeframes for a token from Birdeye.
    
    Args:
        token_mint: Token mint address
        launch_timestamp: Launch date as Unix timestamp (seconds)
        timeframes: List of timeframes to fetch (default: all)
        chain: Blockchain
    
    Returns dict of timeframe -> candles.
    """
    if timeframes is None:
        timeframes = TIMEFRAMES
    
    now_ts = int(datetime.utcnow().timestamp())
    results = {}
    
    for tf in timeframes:
        print(f"    Fetching {tf} data from Birdeye...")
        
        all_candles = []
        
        # Calculate window size based on timeframe (Birdeye returns max 1000 candles)
        window_seconds = {
            "1m": 1000 * 60,           # ~16.6 hours
            "15m": 1000 * 15 * 60,     # ~10 days
            "1h": 1000 * 60 * 60,      # ~41 days
            "1d": 1000 * 24 * 60 * 60, # ~2.7 years
        }.get(tf, 1000 * 60 * 60)
        
        current_from = launch_timestamp
        
        while current_from < now_ts:
            current_to = min(current_from + window_seconds, now_ts)
            
            candles = fetch_birdeye_ohlcv(
                token_mint, tf, current_from, current_to, chain
            )
            
            if candles:
                all_candles.extend(candles)
                oldest = datetime.utcfromtimestamp(candles[0]["timestamp_epoch"]).strftime("%Y-%m-%d")
                newest = datetime.utcfromtimestamp(candles[-1]["timestamp_epoch"]).strftime("%Y-%m-%d")
                print(f"      Fetched {len(candles)} candles ({oldest} to {newest})")
            
            current_from = current_to
            time.sleep(RATE_LIMIT_DELAY)
        
        if all_candles:
            # Sort and deduplicate
            seen = set()
            unique_candles = []
            for c in sorted(all_candles, key=lambda x: x["timestamp_epoch"]):
                if c["timestamp_epoch"] not in seen:
                    seen.add(c["timestamp_epoch"])
                    unique_candles.append(c)
            
            results[tf] = unique_candles
            print(f"      Total: {len(unique_candles):,} candles")
    
    return results


# =============================================================================
# GECKOTERMINAL FETCHER
# =============================================================================
#
# API QUIRK - BACKWARD PAGINATION ONLY:
# GeckoTerminal only supports `before_timestamp`, NOT `after_timestamp`.
# You MUST paginate backwards from present to past.
#
# For incremental fetching, we:
# 1. Fetch the most recent page
# 2. Filter out candles older than our last known timestamp
# 3. Stop when we hit existing data
#
# DO NOT try to add after_timestamp - the API doesn't support it.
# See GOTCHAS.md.
# =============================================================================

def fetch_geckoterminal_ohlcv(
    network: str,
    pool_address: str,
    timeframe: str,
    before_timestamp: Optional[int] = None
) -> Tuple[List[Dict], Optional[int]]:
    """
    Fetch a single page of OHLCV data from GeckoTerminal.

    Args:
        network: Network name (e.g., 'solana', 'eth', 'bsc')
        pool_address: DEX pool address
        timeframe: One of '1m', '15m', '1h', '1d'
        before_timestamp: Pagination - fetch data before this timestamp

    Returns (candles, oldest_timestamp_in_page).
    """
    tf_type, aggregate = TIMEFRAME_TO_GT[timeframe]
    url = f"{GT_API}/networks/{network}/pools/{pool_address}/ohlcv/{tf_type}"
    
    params = {
        "aggregate": aggregate,
        "limit": MAX_CANDLES_PER_REQUEST,
        "currency": "usd",
    }
    
    if before_timestamp:
        params["before_timestamp"] = before_timestamp
    
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, params=params)
        
        if response.status_code == 429:
            print("      Rate limited, waiting 60s...")
            time.sleep(60)
            return fetch_geckoterminal_ohlcv(network, pool_address, timeframe, before_timestamp)
        
        if response.status_code == 401:
            # 180-day paywall hit
            print(f"      GeckoTerminal 401 - likely hit 180-day paywall")
            return [], None
        
        if response.status_code != 200:
            print(f"      Error {response.status_code}: {response.text[:200]}")
            return [], None
        
        data = response.json()
        ohlcv_list = data.get("data", {}).get("attributes", {}).get("ohlcv_list", [])
        
        if not ohlcv_list:
            return [], None
        
        candles = []
        oldest_ts = None
        
        for candle in ohlcv_list:
            ts, o, h, l, c, v = candle
            candles.append({
                "timestamp_epoch": int(ts),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": float(v),
            })
            if oldest_ts is None or ts < oldest_ts:
                oldest_ts = ts
        
        return candles, oldest_ts


def fetch_geckoterminal_all_timeframes(
    network: str,
    pool_address: str,
    timeframes: List[str] = None,
    max_pages: Dict[str, int] = None,
    stop_at_timestamps: Dict[str, int] = None
) -> Dict[str, List[Dict]]:
    """
    Fetch all timeframes for a GeckoTerminal pool.

    Args:
        stop_at_timestamps: Dict of timeframe -> timestamp. Stop fetching when we reach
                           data older than this (for incremental updates).
    """
    if timeframes is None:
        timeframes = TIMEFRAMES

    if max_pages is None:
        max_pages = {
            "1m": 100,
            "15m": 50,
            "1h": 30,
            "1d": 10,
        }

    if stop_at_timestamps is None:
        stop_at_timestamps = {}

    results = {}

    for tf in timeframes:
        stop_ts = stop_at_timestamps.get(tf)
        if stop_ts:
            stop_date = datetime.utcfromtimestamp(stop_ts).strftime("%Y-%m-%d %H:%M")
            print(f"    Fetching {tf} data from GeckoTerminal (since {stop_date})...")
        else:
            print(f"    Fetching {tf} data from GeckoTerminal...")

        all_candles = []
        before_ts = None
        max_pg = max_pages.get(tf, 20)
        reached_existing = False

        for page in range(max_pg):
            candles, oldest_ts = fetch_geckoterminal_ohlcv(
                network, pool_address, tf, before_ts
            )

            if not candles:
                if page == 0:
                    print(f"      No data available")
                break

            # Filter out candles we already have (incremental mode)
            if stop_ts:
                new_candles = [c for c in candles if c["timestamp_epoch"] > stop_ts]
                if len(new_candles) < len(candles):
                    reached_existing = True
                candles = new_candles

            all_candles.extend(candles)
            oldest_date = datetime.utcfromtimestamp(oldest_ts).strftime("%Y-%m-%d")
            print(f"      Page {page + 1}: {len(candles)} new candles (oldest: {oldest_date})")

            # Stop if we've reached existing data or got a partial page
            if reached_existing:
                print(f"      Reached existing data, stopping")
                break

            if len(candles) < MAX_CANDLES_PER_REQUEST:
                break

            before_ts = oldest_ts
            time.sleep(RATE_LIMIT_DELAY)

        if all_candles:
            all_candles.sort(key=lambda x: x["timestamp_epoch"])
            results[tf] = all_candles
            print(f"      Total: {len(all_candles):,} new candles")

    return results


# =============================================================================
# COINGECKO FETCHER (EXISTING)
# =============================================================================

def fetch_coingecko_daily(
    coingecko_id: str,
    days: int = 365
) -> List[Dict]:
    """Fetch daily OHLCV data from CoinGecko."""
    url = f"{CG_API}/coins/{coingecko_id}/ohlc"
    params = {
        "vs_currency": "usd",
        "days": days,
    }
    
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, params=params)
        
        if response.status_code == 429:
            print("      Rate limited, waiting 60s...")
            time.sleep(60)
            return fetch_coingecko_daily(coingecko_id, days)
        
        if response.status_code != 200:
            print(f"      Error {response.status_code}: {response.text[:200]}")
            return []
        
        ohlc_data = response.json()
        
        if not ohlc_data:
            return []
        
        candles = []
        for candle in ohlc_data:
            ts_ms, o, h, l, c = candle
            candles.append({
                "timestamp_epoch": int(ts_ms / 1000),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": 0.0,
            })
        
        return candles


def fetch_coingecko_hourly(
    coingecko_id: str,
    days: int = 30
) -> List[Dict]:
    """
    Fetch hourly price data from CoinGecko market_chart endpoint.
    Free tier: up to 30 days of hourly data.
    """
    url = f"{CG_API}/coins/{coingecko_id}/market_chart"
    params = {
        "vs_currency": "usd",
        "days": days,
    }
    
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, params=params)
        
        if response.status_code == 429:
            print("      Rate limited, waiting 60s...")
            time.sleep(60)
            return fetch_coingecko_hourly(coingecko_id, days)
        
        if response.status_code != 200:
            print(f"      Error {response.status_code}: {response.text[:200]}")
            return []
        
        data = response.json()
        prices = data.get("prices", [])
        
        if not prices:
            return []
        
        # market_chart returns [timestamp_ms, price] pairs
        # We'll create pseudo-OHLC candles (all same since it's just price)
        candles = []
        for ts_ms, price in prices:
            candles.append({
                "timestamp_epoch": int(ts_ms / 1000),
                "open": float(price),
                "high": float(price),
                "low": float(price),
                "close": float(price),
                "volume": 0.0,
            })
        
        return candles


# =============================================================================
# HYPERLIQUID FETCHER (EXISTING)
# =============================================================================

def fetch_hyperliquid_ohlcv(
    coin: str,
    timeframe: str,
    start_time: int,
    end_time: int
) -> List[Dict]:
    """Fetch OHLCV data from Hyperliquid API."""
    interval = HL_INTERVALS.get(timeframe, "1d")

    payload = {
        "type": "candleSnapshot",
        "req": {
            "coin": coin,
            "interval": interval,
            "startTime": start_time,
            "endTime": end_time,
        }
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.post(HL_API, json=payload)

        if response.status_code == 429:
            print("      Rate limited, waiting 60s...")
            time.sleep(60)
            return fetch_hyperliquid_ohlcv(coin, timeframe, start_time, end_time)

        if response.status_code != 200:
            print(f"      Error {response.status_code}: {response.text[:200]}")
            return []

        candle_data = response.json()

        if not candle_data:
            return []

        candles = []
        for c in candle_data:
            candles.append({
                "timestamp_epoch": int(c["t"] / 1000),
                "open": float(c["o"]),
                "high": float(c["h"]),
                "low": float(c["l"]),
                "close": float(c["c"]),
                "volume": float(c["v"]),
            })

        return candles


def fetch_hyperliquid_all_timeframes(
    coin: str,
    launch_timestamp: int,
    timeframes: List[str] = None
) -> Dict[str, List[Dict]]:
    """Fetch all timeframes for a Hyperliquid coin."""
    if timeframes is None:
        timeframes = TIMEFRAMES

    now_ms = int(datetime.utcnow().timestamp() * 1000)
    launch_ms = launch_timestamp * 1000

    results = {}

    for tf in timeframes:
        print(f"    Fetching {tf} data from Hyperliquid...")

        all_candles = []

        window_size_ms = {
            "1m": 5000 * 60 * 1000,
            "15m": 5000 * 15 * 60 * 1000,
            "1h": 5000 * 60 * 60 * 1000,
            "1d": 5000 * 24 * 60 * 60 * 1000,
        }.get(tf, 5000 * 24 * 60 * 60 * 1000)

        current_start = launch_ms

        while current_start < now_ms:
            current_end = min(current_start + window_size_ms, now_ms)

            candles = fetch_hyperliquid_ohlcv(coin, tf, current_start, current_end)

            if candles:
                all_candles.extend(candles)
                oldest = datetime.utcfromtimestamp(candles[0]["timestamp_epoch"]).strftime("%Y-%m-%d")
                newest = datetime.utcfromtimestamp(candles[-1]["timestamp_epoch"]).strftime("%Y-%m-%d")
                print(f"      Fetched {len(candles)} candles ({oldest} to {newest})")

            current_start = current_end
            time.sleep(RATE_LIMIT_DELAY)

        if all_candles:
            seen = set()
            unique_candles = []
            for c in sorted(all_candles, key=lambda x: x["timestamp_epoch"]):
                if c["timestamp_epoch"] not in seen:
                    seen.add(c["timestamp_epoch"])
                    unique_candles.append(c)

            results[tf] = unique_candles
            print(f"      Total: {len(unique_candles):,} candles")

    return results


# =============================================================================
# UNIFIED FETCH ORCHESTRATOR
# =============================================================================

def fetch_for_asset(
    asset_id: str,
    full_fetch: bool = False,
    timeframes: List[str] = None,
    backfill: bool = False,
    recent_only: bool = False
) -> Dict[str, Any]:
    """
    Fetch prices for a specific asset.

    Args:
        asset_id: Asset ID from assets.json
        full_fetch: If True, fetch all history (ignore last_timestamp)
        timeframes: Specific timeframes to fetch (default: based on price_source)
        backfill: If True, use backfill_source (Birdeye) for historical data
        recent_only: If True, only fetch 1-2 pages (for quick hourly updates)

    Returns fetch result stats.
    """
    conn = get_connection()
    init_schema(conn)
    load_assets_from_json(conn)
    
    asset = get_asset(conn, asset_id)
    if not asset:
        conn.close()
        return {"status": "error", "reason": f"Asset '{asset_id}' not found"}
    
    if not asset["enabled"]:
        conn.close()
        return {"status": "skipped", "reason": "Asset is disabled"}
    
    print(f"\n{'='*60}")
    print(f"Fetching prices for {asset['name']}")
    print(f"{'='*60}")
    
    # Determine which source to use
    if backfill and asset.get("backfill_source") == "birdeye" and asset.get("token_mint"):
        price_source = "birdeye"
        print(f"    Mode: BACKFILL from Birdeye")
        print(f"    Token mint: {asset['token_mint']}")
    else:
        price_source = asset["price_source"]
        print(f"    Source: {price_source}")
    
    print(f"    Network: {asset['network']}")
    
    results = {"status": "success", "timeframes": {}, "source": price_source}
    
    # Get launch timestamp
    launch_date = asset.get("launch_date")
    if launch_date:
        if hasattr(launch_date, 'timestamp'):
            launch_ts = int(launch_date.timestamp())
        else:
            launch_ts = int(datetime.fromisoformat(launch_date.replace('Z', '+00:00')).timestamp())
    else:
        launch_ts = int(datetime.utcnow().timestamp()) - (365 * 24 * 3600)
    
    print(f"    Launch: {datetime.utcfromtimestamp(launch_ts).strftime('%Y-%m-%d')}")
    
    # Fetch based on source
    if price_source == "birdeye":
        token_mint = asset.get("token_mint")
        if not token_mint:
            conn.close()
            return {"status": "error", "reason": "No token_mint configured for Birdeye"}
        
        if timeframes is None:
            timeframes = TIMEFRAMES
        
        price_data = fetch_birdeye_all_timeframes(
            token_mint, launch_ts, timeframes, chain=asset.get("network", "solana")
        )
        
        for tf, candles in price_data.items():
            if candles:
                # OUTLIER DETECTION: Remove outliers before insertion
                candles = filter_outliers(candles, asset_id, tf)
                
                inserted = insert_prices(conn, asset_id, tf, candles, data_source="birdeye")
                
                latest_ts = max(c["timestamp_epoch"] for c in candles)
                update_ingestion_state(
                    conn, asset_id, f"prices_{tf}",
                    last_timestamp=datetime.utcfromtimestamp(latest_ts)
                )
                
                results["timeframes"][tf] = {
                    "count": inserted,
                    "latest": datetime.utcfromtimestamp(latest_ts).isoformat(),
                }
    
    elif price_source == "geckoterminal":
        pool_address = asset.get("pool_address")
        network = asset.get("network")
        
        if not pool_address:
            conn.close()
            return {"status": "error", "reason": "No pool_address configured"}
        
        print(f"    Pool: {pool_address}")
        
        if timeframes is None:
            timeframes = TIMEFRAMES

        # Get existing timestamps for incremental fetch (only fetch what's new)
        #
        # TIMEZONE GOTCHA - Use calendar.timegm(), NOT datetime.timestamp():
        # DuckDB returns naive datetime objects. Using .timestamp() interprets
        # them as LOCAL time, which breaks incremental fetch logic.
        # calendar.timegm() correctly treats them as UTC. See GOTCHAS.md.
        stop_at_timestamps = {}
        if not full_fetch:
            for tf in timeframes:
                state = get_ingestion_state(conn, asset_id, f"prices_{tf}")
                if state and state.get("last_timestamp"):
                    last_ts = state["last_timestamp"]
                    if hasattr(last_ts, 'year'):
                        # Naive datetime from DB - treat as UTC (NOT local time!)
                        stop_at_timestamps[tf] = int(calendar.timegm(last_ts.timetuple()))
                    else:
                        stop_at_timestamps[tf] = int(last_ts)

        price_data = fetch_geckoterminal_all_timeframes(
            network, pool_address, timeframes, stop_at_timestamps=stop_at_timestamps
        )
        
        for tf, candles in price_data.items():
            if candles:
                # OUTLIER DETECTION: Remove outliers before insertion
                candles = filter_outliers(candles, asset_id, tf)
                
                inserted = insert_prices(conn, asset_id, tf, candles, data_source="geckoterminal")
                
                latest_ts = max(c["timestamp_epoch"] for c in candles)
                update_ingestion_state(
                    conn, asset_id, f"prices_{tf}",
                    last_timestamp=datetime.utcfromtimestamp(latest_ts)
                )
                
                results["timeframes"][tf] = {
                    "count": inserted,
                    "latest": datetime.utcfromtimestamp(latest_ts).isoformat(),
                }
    
    elif price_source == "coingecko":
        coingecko_id = asset.get("coingecko_id")
        
        if not coingecko_id:
            conn.close()
            return {"status": "error", "reason": "No coingecko_id configured"}
        
        print(f"    CoinGecko ID: {coingecko_id}")
        
        # Fetch daily data
        print(f"    Fetching daily data...")
        candles = fetch_coingecko_daily(coingecko_id, days=90)
        
        if candles:
            # OUTLIER DETECTION: Remove outliers before insertion
            candles = filter_outliers(candles, asset_id, "1d")
            
            inserted = insert_prices(conn, asset_id, "1d", candles, data_source="coingecko")
            latest_ts = max(c["timestamp_epoch"] for c in candles)
            update_ingestion_state(
                conn, asset_id, "prices_1d",
                last_timestamp=datetime.utcfromtimestamp(latest_ts)
            )
            results["timeframes"]["1d"] = {
                "count": inserted,
                "latest": datetime.utcfromtimestamp(latest_ts).isoformat(),
            }
            print(f"      Inserted {inserted} daily candles")
        
        # Also fetch hourly data (30 days max on free tier)
        print(f"    Fetching hourly data (30 days)...")
        hourly_candles = fetch_coingecko_hourly(coingecko_id, days=30)
        
        if hourly_candles:
            # OUTLIER DETECTION: Remove outliers before insertion
            hourly_candles = filter_outliers(hourly_candles, asset_id, "1h")
            
            inserted = insert_prices(conn, asset_id, "1h", hourly_candles, data_source="coingecko")
            latest_ts = max(c["timestamp_epoch"] for c in hourly_candles)
            update_ingestion_state(
                conn, asset_id, "prices_1h",
                last_timestamp=datetime.utcfromtimestamp(latest_ts)
            )
            results["timeframes"]["1h"] = {
                "count": inserted,
                "latest": datetime.utcfromtimestamp(latest_ts).isoformat(),
            }
            print(f"      Inserted {inserted} hourly candles")

    elif price_source == "hyperliquid":
        coin = asset.get("name", asset_id.upper())

        print(f"    Coin: {coin}")

        if timeframes is None:
            timeframes = TIMEFRAMES

        # Get existing timestamp for incremental fetch
        # Use the latest "last_timestamp" across all timeframes
        fetch_from_ts = launch_ts
        if not full_fetch:
            for tf in timeframes:
                state = get_ingestion_state(conn, asset_id, f"prices_{tf}")
                if state and state.get("last_timestamp"):
                    last_ts = state["last_timestamp"]
                    # Handle datetime (treat as UTC) or raw timestamp
                    if hasattr(last_ts, 'year'):
                        ts = int(calendar.timegm(last_ts.timetuple()))
                    else:
                        ts = int(last_ts)
                    fetch_from_ts = max(fetch_from_ts, ts)
            if fetch_from_ts > launch_ts:
                print(f"    Incremental from: {datetime.utcfromtimestamp(fetch_from_ts).strftime('%Y-%m-%d %H:%M')}")

        price_data = fetch_hyperliquid_all_timeframes(coin, fetch_from_ts, timeframes)

        for tf, candles in price_data.items():
            if candles:
                # OUTLIER DETECTION: Remove outliers before insertion
                candles = filter_outliers(candles, asset_id, tf)
                
                inserted = insert_prices(conn, asset_id, tf, candles, data_source="hyperliquid")

                latest_ts = max(c["timestamp_epoch"] for c in candles)
                update_ingestion_state(
                    conn, asset_id, f"prices_{tf}",
                    last_timestamp=datetime.utcfromtimestamp(latest_ts)
                )

                results["timeframes"][tf] = {
                    "count": inserted,
                    "latest": datetime.utcfromtimestamp(latest_ts).isoformat(),
                }

    else:
        conn.close()
        return {"status": "error", "reason": f"Unknown price_source: {price_source}"}
    
    conn.close()
    return results


def fetch_all_assets(
    full_fetch: bool = False,
    timeframes: List[str] = None,
    backfill: bool = False,
    recent_only: bool = False
) -> Dict[str, Any]:
    """
    Fetch prices for all enabled assets.

    Args:
        full_fetch: If True, fetch all history
        timeframes: Specific timeframes to fetch
        backfill: If True, use backfill source for historical data
        recent_only: If True, only fetch 1-2 pages (for hourly updates)

    Returns dict of asset_id -> result.
    """
    conn = get_connection()
    init_schema(conn)
    load_assets_from_json(conn)

    assets = get_enabled_assets(conn)
    conn.close()

    print(f"\nFetching prices for {len(assets)} enabled assets...")
    if recent_only:
        print("Mode: RECENT ONLY (quick incremental update)")
    elif backfill:
        print("Mode: BACKFILL (using Birdeye for Solana tokens)")

    results = {}
    for asset in assets:
        result = fetch_for_asset(
            asset["id"],
            full_fetch=full_fetch,
            timeframes=timeframes,
            backfill=backfill,
            recent_only=recent_only
        )
        results[asset["id"]] = result
        
        time.sleep(1)
    
    # Print summary
    print("\n" + "=" * 60)
    print("FETCH SUMMARY")
    print("=" * 60)
    
    for asset_id, result in results.items():
        status = result.get("status", "unknown")
        source = result.get("source", "?")
        if status == "success":
            tf_summary = ", ".join(
                f"{tf}:{info['count']}" 
                for tf, info in result.get("timeframes", {}).items()
            )
            print(f"  {asset_id} ({source}): {tf_summary or 'no data'}")
        else:
            print(f"  {asset_id}: {status} - {result.get('reason', '')}")
    
    return results


def show_gaps():
    """Show price data gaps."""
    conn = get_connection()
    init_schema(conn)
    
    gaps = get_price_gaps(conn)
    conn.close()
    
    if not gaps:
        print("No gaps detected in price data!")
        return
    
    print(f"\nDetected {len(gaps)} gaps in price data:\n")
    
    # Group by asset
    by_asset = {}
    for g in gaps:
        key = g["asset_id"]
        if key not in by_asset:
            by_asset[key] = []
        by_asset[key].append(g)
    
    for asset_id, asset_gaps in by_asset.items():
        print(f"{asset_id}:")
        for g in asset_gaps[:5]:
            print(f"  {g['timeframe']}: {g['gap_start'][:19]} → {g['gap_end'][:19]} ({g['missing_candles']} missing)")
        if len(asset_gaps) > 5:
            print(f"  ... and {len(asset_gaps) - 5} more gaps")


def main():
    """Main entry point with CLI argument parsing."""
    parser = argparse.ArgumentParser(
        description="Fetch price data for tracked assets"
    )
    parser.add_argument(
        "--asset", "-a",
        type=str,
        help="Specific asset ID to fetch (default: all enabled assets)"
    )
    parser.add_argument(
        "--full", "-f",
        action="store_true",
        help="Full fetch (fetch all available history)"
    )
    parser.add_argument(
        "--timeframe", "-t",
        type=str,
        action="append",
        help="Specific timeframe(s) to fetch (can use multiple times)"
    )
    parser.add_argument(
        "--backfill", "-b",
        action="store_true",
        help="Use backfill source (Birdeye) for historical data"
    )
    parser.add_argument(
        "--gaps", "-g",
        action="store_true",
        help="Show price data gaps"
    )
    parser.add_argument(
        "--recent", "-r",
        action="store_true",
        help="Quick mode: only fetch most recent data (1-2 pages per timeframe)"
    )

    args = parser.parse_args()
    
    if args.gaps:
        show_gaps()
        return
    
    timeframes = args.timeframe if args.timeframe else None
    
    if args.asset:
        fetch_for_asset(
            args.asset,
            full_fetch=args.full,
            timeframes=timeframes,
            backfill=args.backfill,
            recent_only=args.recent
        )
    else:
        fetch_all_assets(
            full_fetch=args.full,
            timeframes=timeframes,
            backfill=args.backfill,
            recent_only=args.recent
        )


if __name__ == "__main__":
    main()
