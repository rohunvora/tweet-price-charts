"""
Export data from DuckDB as static JSON files for the frontend.
Generates per-asset directories with prices and tweet events.

Output structure:
    web/public/data/
        assets.json                 # Copy of asset config for frontend
        {asset_id}/
            prices_1d.json
            prices_1h.json
            prices_15m.json
            prices_1m_index.json
            prices_1m_2025-07.json  # Monthly chunks for 1m data
            tweet_events.json
            stats.json

Usage:
    python export_static.py                 # Export all enabled assets
    python export_static.py --asset pump    # Export specific asset
"""
import argparse
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

from config import PUBLIC_DATA_DIR, ASSETS_FILE
from db import (
    get_connection, init_schema, get_asset, get_enabled_assets,
    get_tweet_events
)


def export_prices_for_asset(
    conn,
    asset_id: str,
    output_dir: Path,
    skip_1m_if_older_than_days: int = 180
) -> Dict[str, int]:
    """
    Export price data for a single asset.
    
    Args:
        skip_1m_if_older_than_days: Skip 1m export if asset launched > N days ago (reduces bloat)
    
    Returns dict of timeframe -> candle count.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    stats = {}
    
    # Get asset launch date to check if we should skip 1m
    asset_info = conn.execute("""
        SELECT launch_date FROM assets WHERE id = ?
    """, [asset_id]).fetchone()
    
    skip_1m = False
    if asset_info and asset_info[0]:
        days_old = (datetime.utcnow() - asset_info[0]).days
        if days_old > skip_1m_if_older_than_days:
            skip_1m = True
            print(f"    (Skipping 1m data - asset is {days_old} days old)")
    
    # Get available timeframes for this asset
    timeframes = conn.execute("""
        SELECT DISTINCT timeframe FROM prices 
        WHERE asset_id = ? 
        ORDER BY timeframe
    """, [asset_id]).fetchall()
    timeframes = [t[0] for t in timeframes]
    
    for tf in timeframes:
        if tf == "1m":
            if skip_1m:
                continue
            # Export 1m data chunked by month
            count = export_1m_chunked(conn, asset_id, output_dir)
        else:
            count = export_timeframe(conn, asset_id, tf, output_dir)
        
        if count > 0:
            stats[tf] = count
    
    return stats


def export_timeframe(
    conn,
    asset_id: str,
    timeframe: str,
    output_dir: Path
) -> int:
    """Export all data for a timeframe to JSON."""
    cursor = conn.execute("""
        SELECT timestamp, open, high, low, close, volume
        FROM prices
        WHERE asset_id = ? AND timeframe = ?
        ORDER BY timestamp
    """, [asset_id, timeframe])
    
    candles = []
    for row in cursor.fetchall():
        ts, o, h, l, c, v = row
        # Compact format for smaller files
        candles.append({
            "t": int(ts.timestamp()) if hasattr(ts, 'timestamp') else ts,
            "o": round(o, 8) if o else 0,
            "h": round(h, 8) if h else 0,
            "l": round(l, 8) if l else 0,
            "c": round(c, 8) if c else 0,
            "v": round(v, 2) if v else 0,
        })
    
    if not candles:
        return 0
    
    output = {
        "asset_id": asset_id,
        "timeframe": timeframe,
        "count": len(candles),
        "start": candles[0]["t"],
        "end": candles[-1]["t"],
        "candles": candles
    }
    
    filename = f"prices_{timeframe}.json"
    filepath = output_dir / filename

    with open(filepath, "w") as f:
        json.dump(output, f, separators=(",", ":"))
    
    size_kb = filepath.stat().st_size / 1024
    print(f"    {timeframe}: {len(candles):,} candles ({size_kb:.1f} KB)")
    
    return len(candles)


def export_1m_chunked(
    conn,
    asset_id: str,
    output_dir: Path
) -> int:
    """Export 1m data chunked by month for lazy loading."""
    cursor = conn.execute("""
        SELECT timestamp, open, high, low, close, volume
        FROM prices
        WHERE asset_id = ? AND timeframe = '1m'
        ORDER BY timestamp
    """, [asset_id])
    
    # Group by month
    months = {}
    for row in cursor.fetchall():
        ts, o, h, l, c, v = row
        
        if hasattr(ts, 'strftime'):
            month_key = ts.strftime("%Y-%m")
            ts_epoch = int(ts.timestamp())
        else:
            dt = datetime.utcfromtimestamp(ts)
            month_key = dt.strftime("%Y-%m")
            ts_epoch = ts
        
        if month_key not in months:
            months[month_key] = []
        
        months[month_key].append({
            "t": ts_epoch,
            "o": round(o, 8) if o else 0,
            "h": round(h, 8) if h else 0,
            "l": round(l, 8) if l else 0,
            "c": round(c, 8) if c else 0,
            "v": round(v, 2) if v else 0,
        })
    
    if not months:
        return 0
    
    total = 0
    
    for month_key, candles in sorted(months.items()):
        output = {
            "asset_id": asset_id,
            "timeframe": "1m",
            "month": month_key,
            "count": len(candles),
            "start": candles[0]["t"],
            "end": candles[-1]["t"],
            "candles": candles
        }
        
        filename = f"prices_1m_{month_key}.json"
        filepath = output_dir / filename
        
        with open(filepath, "w") as f:
            json.dump(output, f, separators=(",", ":"))
        
        size_kb = filepath.stat().st_size / 1024
        print(f"    1m/{month_key}: {len(candles):,} candles ({size_kb:.1f} KB)")
        total += len(candles)
    
    # Create index file for 1m chunks
    index = {
        "asset_id": asset_id,
        "timeframe": "1m",
        "chunks": [
            {
                "month": month_key,
                "file": f"prices_1m_{month_key}.json",
                "count": len(candles),
                "start": candles[0]["t"],
                "end": candles[-1]["t"],
            }
            for month_key, candles in sorted(months.items())
        ]
    }
    
    with open(output_dir / "prices_1m_index.json", "w") as f:
        json.dump(index, f, indent=2)
    
    return total


def export_tweet_events_for_asset(
    conn,
    asset_id: str,
    output_dir: Path,
    use_daily_fallback: bool = False,
    filter_no_price: bool = True
) -> int:
    """
    Export tweet events for a single asset.
    
    Args:
        filter_no_price: If True, exclude tweets without price data
    
    Returns count of events exported.
    """
    # Check if asset has 1m price data, otherwise try 1h
    has_1m = conn.execute("""
        SELECT COUNT(*) FROM prices 
        WHERE asset_id = ? AND timeframe = '1m'
    """, [asset_id]).fetchone()[0] > 0
    
    has_1h = conn.execute("""
        SELECT COUNT(*) FROM prices 
        WHERE asset_id = ? AND timeframe = '1h'
    """, [asset_id]).fetchone()[0] > 0
    
    # Use daily fallback if no 1m or 1h data
    if not has_1m and not has_1h:
        use_daily_fallback = True
    
    events = get_tweet_events(conn, asset_id, use_daily_fallback=use_daily_fallback)
    
    if not events:
        return 0
    
    # Filter out tweets without price data
    original_count = len(events)
    if filter_no_price:
        events = [e for e in events if e.get("price_at_tweet") is not None]
        filtered_count = original_count - len(events)
        if filtered_count > 0:
            print(f"    (Filtered {filtered_count} tweets without price data)")
    
    if not events:
        print(f"    Tweet events: 0 events (all filtered - no price data)")
        return 0
    
    # Get asset info for metadata
    asset = get_asset(conn, asset_id)
    
    output = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "asset": asset_id,
        "asset_name": asset["name"] if asset else asset_id.upper(),
        "founder": asset["founder"] if asset else "",
        "price_definition": "candle close at minute boundary" if not use_daily_fallback else "daily close",
        "count": len(events),
        "events": events
    }
    
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / "tweet_events.json"
    
    with open(filepath, "w") as f:
        json.dump(output, f, indent=2)
    
    size_kb = filepath.stat().st_size / 1024
    print(f"    Tweet events: {len(events)} events ({size_kb:.1f} KB)")
    
    return len(events)


def export_asset(asset_id: str) -> Dict[str, Any]:
    """Export all data for a single asset."""
    conn = get_connection()
    init_schema(conn)
    
    asset = get_asset(conn, asset_id)
    if not asset:
        conn.close()
        return {"status": "error", "reason": f"Asset '{asset_id}' not found"}
    
    print(f"\nExporting {asset['name']} ({asset_id})...")
    
    output_dir = PUBLIC_DATA_DIR / asset_id
    
    # Export prices
    price_stats = export_prices_for_asset(conn, asset_id, output_dir)
    
    # Export tweet events
    events_count = export_tweet_events_for_asset(conn, asset_id, output_dir)
    
    conn.close()
    
    return {
        "status": "success",
        "prices": price_stats,
        "tweet_events": events_count,
    }


def export_all_assets() -> Dict[str, Any]:
    """Export data for all enabled assets."""
    conn = get_connection()
    init_schema(conn)
    
    assets = get_enabled_assets(conn)
    conn.close()
    
    print(f"Exporting {len(assets)} enabled assets...")
    
    results = {}
    for asset in assets:
        result = export_asset(asset["id"])
        results[asset["id"]] = result
    
    return results


def export_assets_json():
    """Copy assets.json to public directory for frontend."""
    if not ASSETS_FILE.exists():
        print("Warning: assets.json not found")
        return
    
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load and filter to only enabled assets, and remove internal fields
    with open(ASSETS_FILE) as f:
        config = json.load(f)
    
    # Create frontend-friendly version
    frontend_assets = []
    for asset in config.get("assets", []):
        if asset.get("enabled", True):
            frontend_assets.append({
                "id": asset["id"],
                "name": asset["name"],
                "founder": asset["founder"],
                "network": asset.get("network"),
                "launch_date": asset["launch_date"],
                "color": asset.get("color"),
                "enabled": True,  # All exported assets are enabled
            })
    
    output = {
        "version": config.get("version", "1.0.0"),
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "assets": frontend_assets
    }
    
    output_path = PUBLIC_DATA_DIR / "assets.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\nExported assets.json with {len(frontend_assets)} assets")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Export data as static JSON for frontend"
    )
    parser.add_argument(
        "--asset", "-a",
        type=str,
        help="Specific asset ID to export (default: all enabled assets)"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Exporting Static Data")
    print("=" * 60)
    print(f"Output: {PUBLIC_DATA_DIR}")
    
    # Always export assets.json
    export_assets_json()
    
    if args.asset:
        result = export_asset(args.asset)
        print(f"\nResult: {result}")
    else:
        results = export_all_assets()
        
        # Print summary
        print("\n" + "=" * 60)
        print("EXPORT SUMMARY")
        print("=" * 60)
        
        for asset_id, result in results.items():
            status = result.get("status", "unknown")
            if status == "success":
                prices = result.get("prices", {})
                events = result.get("tweet_events", 0)
                price_summary = ", ".join(f"{tf}:{count}" for tf, count in prices.items())
                print(f"  {asset_id}: {price_summary}, {events} events")
            else:
                print(f"  {asset_id}: {status} - {result.get('reason', '')}")
    
    # List generated files
    print("\n" + "=" * 60)
    print("Generated files:")
    print("=" * 60)
    
    for f in sorted(PUBLIC_DATA_DIR.rglob("*.json")):
        rel_path = f.relative_to(PUBLIC_DATA_DIR)
        size_kb = f.stat().st_size / 1024
        print(f"  {rel_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
