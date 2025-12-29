#!/usr/bin/env python3
"""
One-time script to reset tweet watermarks for founder assets.

Background:
- Previously, fetch_tweets.py incorrectly applied keyword filtering to founder assets
- This caused tweets to be filtered out, but the watermark was still advanced
- Result: tweets between old watermark and new watermark are "lost"

Solution:
- Reset the ingestion_state for founder assets so they do a fresh fetch
- This will recover any missed tweets

This script is safe to run multiple times - it only affects founder assets.
After running once successfully, this script can be deleted.

Usage:
    python reset_founder_watermarks.py [--dry-run]
"""
import sys
import argparse
from pathlib import Path

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from db import init_db, get_connection, load_assets_from_json


def get_founder_assets(conn):
    """Get list of founder asset IDs (not adopters)."""
    results = conn.execute("""
        SELECT id, name, founder, founder_type
        FROM assets
        WHERE enabled = true
          AND (founder_type IS NULL OR founder_type != 'adopter')
    """).fetchall()
    
    return [{"id": r[0], "name": r[1], "founder": r[2], "founder_type": r[3]} for r in results]


def get_current_watermarks(conn, asset_ids):
    """Get current watermarks for assets."""
    watermarks = {}
    for asset_id in asset_ids:
        result = conn.execute("""
            SELECT last_id, last_timestamp
            FROM ingestion_state
            WHERE asset_id = ? AND data_type = 'tweets'
        """, [asset_id]).fetchone()
        
        if result:
            watermarks[asset_id] = {"last_id": result[0], "last_timestamp": result[1]}
    
    return watermarks


def reset_watermarks(conn, asset_ids, dry_run=False):
    """Reset watermarks for specified assets."""
    reset_count = 0
    
    for asset_id in asset_ids:
        if dry_run:
            print(f"  [DRY RUN] Would reset watermark for {asset_id}")
        else:
            # Delete the ingestion_state entry for tweets
            conn.execute("""
                DELETE FROM ingestion_state
                WHERE asset_id = ? AND data_type = 'tweets'
            """, [asset_id])
            
            # Also delete tweets_oldest state
            conn.execute("""
                DELETE FROM ingestion_state
                WHERE asset_id = ? AND data_type = 'tweets_oldest'
            """, [asset_id])
            
            print(f"  ✓ Reset watermark for {asset_id}")
        
        reset_count += 1
    
    return reset_count


def main():
    parser = argparse.ArgumentParser(description="Reset tweet watermarks for founder assets")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    args = parser.parse_args()
    
    print("=" * 60)
    print("FOUNDER WATERMARK RESET")
    print("=" * 60)
    
    if args.dry_run:
        print("MODE: DRY RUN (no changes will be made)\n")
    else:
        print("MODE: LIVE (will reset watermarks)\n")
    
    # Initialize DB and load assets
    conn = init_db()
    load_assets_from_json(conn)
    
    # Get founder assets
    founders = get_founder_assets(conn)
    founder_ids = [f["id"] for f in founders]
    
    print(f"Found {len(founders)} founder assets:")
    for f in founders:
        print(f"  - {f['name']} (@{f['founder']})")
    
    print()
    
    # Get current watermarks
    watermarks = get_current_watermarks(conn, founder_ids)
    
    print("Current watermarks:")
    for asset_id, wm in watermarks.items():
        print(f"  {asset_id}: last_id={wm['last_id']}, timestamp={wm['last_timestamp']}")
    
    # Find assets without watermarks
    no_watermark = [aid for aid in founder_ids if aid not in watermarks]
    if no_watermark:
        print(f"\nAssets with no watermark (will do full fetch anyway): {no_watermark}")
    
    print()
    
    # Reset watermarks
    assets_to_reset = [aid for aid in founder_ids if aid in watermarks]
    
    if not assets_to_reset:
        print("No watermarks to reset!")
        conn.close()
        return
    
    print(f"Resetting watermarks for {len(assets_to_reset)} assets:")
    reset_count = reset_watermarks(conn, assets_to_reset, dry_run=args.dry_run)
    
    if not args.dry_run:
        conn.commit()
        print(f"\n✅ Reset {reset_count} watermarks successfully!")
        print("Next fetch_tweets.py run will do a full fetch for these assets.")
    else:
        print(f"\n[DRY RUN] Would reset {reset_count} watermarks.")
    
    conn.close()


if __name__ == "__main__":
    main()

