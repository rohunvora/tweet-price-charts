"""
Fetch tweets from founders using X API v2.
RESILIENT VERSION: Saves each page immediately, can resume from interruption.

Features:
- Incremental page-by-page saving (no data loss on timeout)
- Dual watermarks: newest_id (for updates) + oldest_id (for backfill)
- Automatic retry with exponential backoff
- Resume capability after interruption

Usage:
    python fetch_tweets.py                    # Update all assets (fetch new tweets)
    python fetch_tweets.py --asset pump       # Update specific asset
    python fetch_tweets.py --asset pump --backfill  # Backfill older tweets
    python fetch_tweets.py --full             # Full refetch (ignore watermarks)
"""
import argparse
import httpx
import json
import time
import random
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

from config import (
    X_BEARER_TOKEN,
    X_API_BASE,
    RATE_LIMIT_DELAY,
    DATA_DIR
)
from db import (
    get_connection, init_schema, get_asset, get_enabled_assets,
    get_ingestion_state, update_ingestion_state, insert_tweets,
    load_assets_from_json
)


def get_user_id(client: httpx.Client, username: str) -> Optional[str]:
    """Get the user ID from username with retry."""
    url = f"{X_API_BASE}/users/by/username/{username}"
    
    for attempt in range(3):
        try:
            response = client.get(url, timeout=30.0)
            if response.status_code == 429:
                wait = (2 ** attempt) * 15 + random.uniform(0, 5)
                print(f"      Rate limited on user lookup, waiting {wait:.0f}s...")
                time.sleep(wait)
                continue
            response.raise_for_status()
            data = response.json()
            return data["data"]["id"]
        except httpx.TimeoutException:
            print(f"      Timeout on user lookup (attempt {attempt + 1}/3)")
            time.sleep(5)
        except Exception as e:
            print(f"      Error looking up user: {e}")
            if attempt < 2:
                time.sleep(5)
    
    return None


def fetch_tweet_page(
    client: httpx.Client,
    user_id: str,
    since_id: Optional[str] = None,
    until_id: Optional[str] = None,
    pagination_token: Optional[str] = None,
    max_results: int = 100
) -> Tuple[List[Dict], Optional[str], bool]:
    """
    Fetch a single page of tweets with retry logic.
    
    Args:
        client: HTTP client
        user_id: Twitter user ID
        since_id: Only return tweets newer than this ID
        until_id: Only return tweets older than this ID (for backfill)
        pagination_token: Token for pagination
        max_results: Max tweets per page
    
    Returns (tweets, next_pagination_token, success)
    """
    url = f"{X_API_BASE}/users/{user_id}/tweets"
    params = {
        "max_results": max_results,
        "tweet.fields": "created_at,public_metrics,conversation_id",
        "exclude": "retweets,replies",
    }
    
    if since_id:
        params["since_id"] = since_id
    if until_id:
        params["until_id"] = until_id
    if pagination_token:
        params["pagination_token"] = pagination_token
    
    for attempt in range(3):
        try:
            response = client.get(url, params=params, timeout=30.0)
            
            if response.status_code == 429:
                # Rate limited - wait with exponential backoff
                wait = (2 ** attempt) * 30 + random.uniform(0, 10)
                print(f"      Rate limited, waiting {wait:.0f}s (attempt {attempt + 1}/3)...")
                time.sleep(wait)
                continue
            
            if response.status_code != 200:
                print(f"      API error {response.status_code}: {response.text[:100]}")
                return [], None, False
            
            data = response.json()
            tweets_data = data.get("data", [])
            
            # Process tweets
            tweets = []
            for tweet in tweets_data:
                metrics = tweet.get("public_metrics", {})
                tweets.append({
                    "id": tweet["id"],
                    "text": tweet["text"],
                    "created_at": tweet["created_at"],
                    "timestamp": parse_iso_timestamp(tweet["created_at"]),
                    "likes": metrics.get("like_count", 0),
                    "retweets": metrics.get("retweet_count", 0),
                    "replies": metrics.get("reply_count", 0),
                    "impressions": metrics.get("impression_count", 0),
                })
            
            next_token = data.get("meta", {}).get("next_token")
            return tweets, next_token, True
            
        except httpx.TimeoutException:
            wait = (2 ** attempt) * 5 + random.uniform(0, 3)
            print(f"      Timeout (attempt {attempt + 1}/3), waiting {wait:.0f}s...")
            time.sleep(wait)
        except Exception as e:
            print(f"      Error: {e}")
            if attempt < 2:
                time.sleep(5)
    
    return [], None, False


def parse_iso_timestamp(iso_str: str) -> datetime:
    """Parse ISO timestamp string to timezone-aware datetime."""
    iso_str = iso_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(iso_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def fetch_for_asset(
    asset_id: str,
    full_fetch: bool = False,
    backfill: bool = False,
    max_pages: int = 50
) -> Dict[str, Any]:
    """
    Fetch tweets for a specific asset with incremental saving.
    
    Args:
        asset_id: Asset ID from assets.json
        full_fetch: If True, ignore watermarks and fetch everything
        backfill: If True, fetch older tweets (use oldest_id as until_id)
        max_pages: Maximum pages to fetch per run
    
    Returns fetch result stats.
    """
    if not X_BEARER_TOKEN:
        return {"status": "error", "reason": "X_BEARER_TOKEN not configured"}
    
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
    print(f"Fetching tweets for {asset['name']} (@{asset['founder']})")
    print(f"{'='*60}")
    
    # Get launch date for filtering
    launch_date = asset["launch_date"]
    if isinstance(launch_date, str):
        launch_date = parse_iso_timestamp(launch_date)
    if launch_date.tzinfo is None:
        launch_date = launch_date.replace(tzinfo=timezone.utc)
    
    # Get watermarks from ingestion state
    state = get_ingestion_state(conn, asset_id, "tweets")
    newest_id = None
    oldest_id = None
    
    if state and not full_fetch:
        newest_id = state.get("last_id")  # Most recent tweet we have
        # Get oldest_id from a separate state entry
        oldest_state = get_ingestion_state(conn, asset_id, "tweets_oldest")
        if oldest_state:
            oldest_id = oldest_state.get("last_id")
    
    # Determine fetch mode
    if backfill and oldest_id:
        print(f"    Mode: BACKFILL (fetching tweets older than {oldest_id})")
        since_id = None
        until_id = oldest_id
    elif newest_id and not full_fetch:
        print(f"    Mode: UPDATE (fetching tweets newer than {newest_id})")
        since_id = newest_id
        until_id = None
    else:
        print(f"    Mode: FULL FETCH")
        since_id = None
        until_id = None
    
    # Set up HTTP client
    headers = {"Authorization": f"Bearer {X_BEARER_TOKEN}"}
    
    total_fetched = 0
    total_inserted = 0
    total_filtered = 0
    page = 0
    pagination_token = None
    
    # Track watermarks for this run
    run_newest_id = None
    run_oldest_id = None
    
    with httpx.Client(headers=headers) as client:
        # Get user ID first
        print(f"    Looking up @{asset['founder']}...")
        user_id = get_user_id(client, asset["founder"])
        
        if not user_id:
            conn.close()
            return {"status": "error", "reason": "Could not look up user"}
        
        print(f"    User ID: {user_id}")
        
        # Fetch pages
        while page < max_pages:
            page += 1
            
            tweets, next_token, success = fetch_tweet_page(
                client, user_id,
                since_id=since_id,
                until_id=until_id,
                pagination_token=pagination_token
            )
            
            if not success:
                print(f"    Page {page}: Failed to fetch, stopping")
                break
            
            if not tweets:
                if page == 1:
                    print(f"    No {'new ' if since_id else ''}tweets found")
                break
            
            # Filter pre-launch tweets
            filtered_tweets = []
            for t in tweets:
                tweet_time = t["timestamp"]
                if tweet_time < launch_date:
                    total_filtered += 1
                    continue
                filtered_tweets.append(t)
                
                # Track watermarks
                tid = t["id"]
                if run_newest_id is None or tid > run_newest_id:
                    run_newest_id = tid
                if run_oldest_id is None or tid < run_oldest_id:
                    run_oldest_id = tid
            
            total_fetched += len(tweets)
            
            # INSERT IMMEDIATELY - this is the key for resilience
            if filtered_tweets:
                inserted = insert_tweets(conn, asset_id, filtered_tweets)
                total_inserted += inserted
                
                # Update watermarks after each successful page
                if run_newest_id and (newest_id is None or run_newest_id > newest_id):
                    update_ingestion_state(conn, asset_id, "tweets", last_id=run_newest_id)
                
                if run_oldest_id:
                    update_ingestion_state(conn, asset_id, "tweets_oldest", last_id=run_oldest_id)
            
            print(f"    Page {page}: {len(tweets)} fetched, {len(filtered_tweets)} kept, {total_inserted} total saved")
            
            # Check for more pages
            if not next_token:
                print(f"    No more pages")
                break
            
            pagination_token = next_token
            
            # Rate limiting between pages
            time.sleep(RATE_LIMIT_DELAY)
    
    # Summary
    print(f"\n    Summary: {total_fetched} fetched, {total_filtered} pre-launch filtered, {total_inserted} saved")
    
    if run_newest_id:
        print(f"    Newest tweet ID: {run_newest_id}")
    if run_oldest_id:
        print(f"    Oldest tweet ID: {run_oldest_id}")
    
    conn.close()
    
    return {
        "status": "success",
        "fetched": total_fetched,
        "filtered": total_filtered,
        "inserted": total_inserted,
        "newest_id": run_newest_id,
        "oldest_id": run_oldest_id,
    }


def fetch_all_assets(
    full_fetch: bool = False,
    backfill: bool = False
) -> Dict[str, Any]:
    """
    Fetch tweets for all enabled assets.
    """
    conn = get_connection()
    init_schema(conn)
    load_assets_from_json(conn)
    
    assets = get_enabled_assets(conn)
    conn.close()
    
    print(f"\nFetching tweets for {len(assets)} enabled assets...")
    if backfill:
        print("Mode: BACKFILL (fetching older tweets)")
    elif full_fetch:
        print("Mode: FULL FETCH (ignoring watermarks)")
    else:
        print("Mode: UPDATE (fetching new tweets only)")
    
    results = {}
    for asset in assets:
        result = fetch_for_asset(
            asset["id"], 
            full_fetch=full_fetch,
            backfill=backfill
        )
        results[asset["id"]] = result
        
        # Pause between assets to avoid rate limits
        time.sleep(2)
    
    # Print summary
    print("\n" + "=" * 60)
    print("FETCH SUMMARY")
    print("=" * 60)
    
    total_fetched = 0
    total_inserted = 0
    for asset_id, result in results.items():
        status = result.get("status", "unknown")
        if status == "success":
            fetched = result.get("fetched", 0)
            inserted = result.get("inserted", 0)
            total_fetched += fetched
            total_inserted += inserted
            print(f"  {asset_id}: {fetched} fetched, {inserted} saved")
        else:
            print(f"  {asset_id}: {status} - {result.get('reason', '')}")
    
    print(f"\nTotal: {total_fetched} tweets fetched, {total_inserted} saved")
    
    return results


def main():
    """Main entry point with CLI argument parsing."""
    parser = argparse.ArgumentParser(
        description="Fetch tweets for tracked assets (resilient version)"
    )
    parser.add_argument(
        "--asset", "-a",
        type=str,
        help="Specific asset ID to fetch (default: all enabled assets)"
    )
    parser.add_argument(
        "--full", "-f",
        action="store_true",
        help="Full fetch (ignore watermarks, fetch all available tweets)"
    )
    parser.add_argument(
        "--backfill", "-b",
        action="store_true",
        help="Backfill mode (fetch older tweets we don't have yet)"
    )
    parser.add_argument(
        "--max-pages", "-m",
        type=int,
        default=50,
        help="Maximum pages to fetch per asset (default: 50)"
    )
    
    args = parser.parse_args()
    
    if args.asset:
        fetch_for_asset(
            args.asset, 
            full_fetch=args.full,
            backfill=args.backfill,
            max_pages=args.max_pages
        )
    else:
        fetch_all_assets(
            full_fetch=args.full,
            backfill=args.backfill
        )


if __name__ == "__main__":
    main()
