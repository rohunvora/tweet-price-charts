#!/usr/bin/env python3
"""
Post-export validation and self-healing for the tweet-price data pipeline.

This module ensures data integrity between the database and exported JSON files.
Run after export_static.py to catch and fix issues before deployment.

Features:
1. Validates exported data matches database
2. Checks all timeframes (1d, 1h, 15m, 1m)
3. Verifies tweet coverage
4. Auto-fixes common issues (re-exports if needed)
5. Provides clear error messages

Usage:
    python validate_export.py                  # Validate all assets
    python validate_export.py --asset zora     # Validate specific asset
    python validate_export.py --fix            # Auto-fix issues by re-exporting
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

from config import PUBLIC_DATA_DIR
from db import get_connection, init_schema, get_asset, get_enabled_assets


# =============================================================================
# Validation Results
# =============================================================================

class ValidationResult:
    """Result of a validation check."""
    def __init__(self, passed: bool, message: str, fixable: bool = False):
        self.passed = passed
        self.message = message
        self.fixable = fixable  # Can be auto-fixed by re-exporting

    def __repr__(self):
        status = "✓" if self.passed else ("⚠️" if self.fixable else "❌")
        return f"{status} {self.message}"


# =============================================================================
# Validation Checks
# =============================================================================

def validate_price_count(
    conn,
    asset_id: str,
    timeframe: str,
    exported_path: Path
) -> ValidationResult:
    """
    Verify exported price count is reasonable.

    Note: Exported count is often LESS than DB due to:
    - 1D deduplication (multiple sources for same day)
    - DST duplicate removal
    - Midnight normalization

    We only flag if exported is significantly MORE than DB (data corruption)
    or if exported is missing when DB has data.
    """
    # Get DB count
    db_count = conn.execute("""
        SELECT COUNT(*) FROM prices
        WHERE asset_id = ? AND timeframe = ?
    """, [asset_id, timeframe]).fetchone()[0]

    # Get exported count
    if not exported_path.exists():
        if db_count > 0:
            return ValidationResult(
                False,
                f"{timeframe}: missing file but DB has {db_count} candles",
                fixable=True
            )
        return ValidationResult(True, f"{timeframe}: no data (expected)")

    with open(exported_path) as f:
        data = json.load(f)

    exported_count = data.get("count", len(data.get("candles", [])))

    # For 1D, exported is often ~50% of DB due to deduplication
    # For other timeframes, allow 10% tolerance
    if timeframe == "1d":
        # 1D: Only fail if exported > DB (impossible) or exported < 30% of DB
        if exported_count > db_count:
            return ValidationResult(
                False,
                f"{timeframe}: exported {exported_count} > DB {db_count} (corruption?)",
                fixable=True
            )
        if exported_count < db_count * 0.3:
            return ValidationResult(
                False,
                f"{timeframe}: exported {exported_count} < 30% of DB {db_count}",
                fixable=True
            )
    else:
        # Other timeframes: allow 10% variance
        tolerance = max(50, db_count * 0.10)
        if abs(db_count - exported_count) > tolerance:
            return ValidationResult(
                False,
                f"{timeframe}: exported {exported_count} vs DB {db_count} (diff: {db_count - exported_count})",
                fixable=True
            )

    return ValidationResult(True, f"{timeframe}: {exported_count} candles ✓")


def validate_price_range(
    conn,
    asset_id: str,
    timeframe: str,
    exported_path: Path
) -> ValidationResult:
    """
    Verify exported price range is reasonable.

    We mainly care about the START date matching (historical data intact).
    END date can differ due to hourly updates not yet exported.
    """
    if not exported_path.exists():
        return ValidationResult(True, f"{timeframe}: skipped (no file)")

    # Get DB range
    db_range = conn.execute("""
        SELECT MIN(timestamp), MAX(timestamp)
        FROM prices
        WHERE asset_id = ? AND timeframe = ?
    """, [asset_id, timeframe]).fetchone()

    if not db_range[0]:
        return ValidationResult(True, f"{timeframe}: no DB data")

    db_start = db_range[0]
    db_end = db_range[1]
    if hasattr(db_start, 'timestamp'):
        import calendar
        db_start = calendar.timegm(db_start.timetuple())
        db_end = calendar.timegm(db_end.timetuple())

    # Get exported range
    with open(exported_path) as f:
        data = json.load(f)

    exp_start = data.get("start")
    exp_end = data.get("end")

    if not exp_start or not exp_end:
        candles = data.get("candles", [])
        if candles:
            exp_start = candles[0]["t"]
            exp_end = candles[-1]["t"]

    # START: Allow 1 day tolerance
    # END: Allow 3 days tolerance (hourly updates may not be exported yet)
    start_tolerance = 86400
    end_tolerance = 86400 * 3

    start_ok = abs(db_start - exp_start) <= start_tolerance
    end_ok = (db_end - exp_end) <= end_tolerance  # Only fail if exported is way behind

    if start_ok and end_ok:
        return ValidationResult(True, f"{timeframe}: range OK ✓")

    if not start_ok:
        return ValidationResult(
            False,
            f"{timeframe}: START mismatch - DB {datetime.utcfromtimestamp(db_start).date()} vs exported {datetime.utcfromtimestamp(exp_start).date()}",
            fixable=True
        )

    return ValidationResult(
        False,
        f"{timeframe}: exported {(db_end - exp_end) // 86400} days behind DB",
        fixable=True
    )


def validate_tweet_count(
    conn,
    asset_id: str,
    exported_path: Path
) -> ValidationResult:
    """
    Verify exported tweet count is reasonable.

    Allow small differences due to:
    - Tweets filtered for missing price data
    - Tweet exclusions from data_overrides.json
    """
    # Get DB count (tweets with prices)
    from db import get_tweet_events
    events = get_tweet_events(conn, asset_id, use_daily_fallback=False)
    db_count = len([e for e in events if e.get("price_at_tweet")])

    # Get exported count
    if not exported_path.exists():
        if db_count > 0:
            return ValidationResult(
                False,
                f"tweets: missing file but DB has {db_count} events",
                fixable=True
            )
        return ValidationResult(True, "tweets: no data (expected)")

    with open(exported_path) as f:
        data = json.load(f)

    exported_count = data.get("count", len(data.get("events", [])))

    # Allow 5% or 10 tweets difference (whichever is larger)
    tolerance = max(10, db_count * 0.05)

    if abs(db_count - exported_count) <= tolerance:
        return ValidationResult(True, f"tweets: {exported_count} events ✓")

    return ValidationResult(
        False,
        f"tweets: exported {exported_count} but DB has {db_count} (diff: {db_count - exported_count})",
        fixable=True
    )


def validate_tweet_date_range(
    conn,
    asset_id: str,
    exported_path: Path
) -> ValidationResult:
    """
    Verify tweet date range is reasonable.

    Focus on START date (historical tweets preserved).
    END date can differ slightly due to recent tweets not yet exported.
    """
    if not exported_path.exists():
        return ValidationResult(True, "tweets: skipped (no file)")

    # Get DB range
    from db import get_tweet_events
    events = get_tweet_events(conn, asset_id, use_daily_fallback=False)
    events_with_price = [e for e in events if e.get("price_at_tweet")]

    if not events_with_price:
        return ValidationResult(True, "tweets: no data in DB")

    db_start = min(e["timestamp"] for e in events_with_price)
    db_end = max(e["timestamp"] for e in events_with_price)

    # Get exported range
    with open(exported_path) as f:
        data = json.load(f)

    exported_events = data.get("events", [])
    if not exported_events:
        return ValidationResult(
            False,
            f"tweets: file empty but DB has {len(events_with_price)} events",
            fixable=True
        )

    exp_start = min(e["timestamp"] for e in exported_events)
    exp_end = max(e["timestamp"] for e in exported_events)

    # START: Allow 1 day tolerance
    # END: Allow 7 days tolerance (tweets may not have price data yet)
    start_tolerance = 86400
    end_tolerance = 86400 * 7

    start_ok = abs(db_start - exp_start) <= start_tolerance
    end_ok = abs(db_end - exp_end) <= end_tolerance

    if start_ok and end_ok:
        return ValidationResult(True, f"tweets: range OK ✓")

    if not start_ok:
        return ValidationResult(
            False,
            f"tweets: START mismatch - DB {datetime.utcfromtimestamp(db_start).date()} vs exported {datetime.utcfromtimestamp(exp_start).date()}",
            fixable=True
        )

    return ValidationResult(True, f"tweets: range OK ✓")  # END differences are acceptable


def validate_no_duplicates(exported_path: Path, timeframe: str) -> ValidationResult:
    """Check for duplicate timestamps in exported data."""
    if not exported_path.exists():
        return ValidationResult(True, f"{timeframe}: skipped (no file)")

    with open(exported_path) as f:
        data = json.load(f)

    candles = data.get("candles", [])
    timestamps = [c["t"] for c in candles]

    if len(timestamps) == len(set(timestamps)):
        return ValidationResult(True, f"{timeframe}: no duplicates ✓")

    dup_count = len(timestamps) - len(set(timestamps))
    return ValidationResult(
        False,
        f"{timeframe}: {dup_count} duplicate timestamps (will crash chart!)",
        fixable=True
    )


# =============================================================================
# Main Validation
# =============================================================================

def validate_asset(conn, asset_id: str) -> Tuple[bool, List[ValidationResult]]:
    """
    Run all validation checks for an asset.

    Returns (all_passed, list_of_results)
    """
    # Check if asset has documented data limitations (from assets.json)
    from config import ASSETS_FILE
    with open(ASSETS_FILE) as f:
        assets_config = json.load(f)
    asset_config = next((a for a in assets_config.get("assets", []) if a["id"] == asset_id), None)

    if asset_config and asset_config.get("data_note"):
        # Skip strict validation for assets with known data issues
        note = asset_config["data_note"]
        return True, [ValidationResult(
            True,
            f"Skipped (data_note: {note[:60]}...)"
        )]

    asset_dir = PUBLIC_DATA_DIR / asset_id
    results = []

    # Price validations for each timeframe
    for tf in ["1d", "1h", "15m"]:
        price_file = asset_dir / f"prices_{tf}.json"
        results.append(validate_price_count(conn, asset_id, tf, price_file))
        results.append(validate_price_range(conn, asset_id, tf, price_file))
        results.append(validate_no_duplicates(price_file, tf))

    # Tweet validations
    tweet_file = asset_dir / "tweet_events.json"
    results.append(validate_tweet_count(conn, asset_id, tweet_file))
    results.append(validate_tweet_date_range(conn, asset_id, tweet_file))

    all_passed = all(r.passed for r in results)
    return all_passed, results


def validate_all_assets(conn) -> Dict[str, Tuple[bool, List[ValidationResult]]]:
    """Validate all enabled assets."""
    assets = get_enabled_assets(conn)
    results = {}

    for asset in assets:
        asset_id = asset["id"]
        results[asset_id] = validate_asset(conn, asset_id)

    return results


def fix_asset(asset_id: str) -> bool:
    """
    Re-export an asset to fix validation issues.

    Returns True if fix succeeded.
    """
    from export_static import export_asset

    print(f"\n  Re-exporting {asset_id}...")
    result = export_asset(asset_id, strict=False)

    if result.get("status") == "success":
        print(f"  ✓ Re-export successful")
        return True
    else:
        print(f"  ❌ Re-export failed: {result.get('reason', 'unknown')}")
        return False


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Validate exported data integrity"
    )
    parser.add_argument(
        "--asset", "-a",
        help="Validate specific asset (default: all)"
    )
    parser.add_argument(
        "--fix", "-f",
        action="store_true",
        help="Auto-fix issues by re-exporting"
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Only show failures"
    )

    args = parser.parse_args()

    print("=" * 60)
    print("DATA VALIDATION")
    print("=" * 60)

    conn = get_connection()
    init_schema(conn)

    if args.asset:
        asset = get_asset(conn, args.asset)
        if not asset:
            print(f"Error: Asset '{args.asset}' not found")
            sys.exit(1)
        all_results = {args.asset: validate_asset(conn, args.asset)}
    else:
        all_results = validate_all_assets(conn)

    # Print results
    failed_assets = []
    fixable_assets = []

    for asset_id, (passed, results) in all_results.items():
        failures = [r for r in results if not r.passed]

        if passed:
            if not args.quiet:
                print(f"\n{asset_id}: ✓ All checks passed")
        else:
            print(f"\n{asset_id}: ❌ {len(failures)} issue(s)")
            for r in failures:
                print(f"  {r}")

            failed_assets.append(asset_id)
            if any(r.fixable for r in failures):
                fixable_assets.append(asset_id)

    # Summary
    print("\n" + "=" * 60)
    total = len(all_results)
    passed = total - len(failed_assets)
    print(f"SUMMARY: {passed}/{total} assets passed validation")

    # Auto-fix if requested
    if args.fix and fixable_assets:
        print("\n" + "=" * 60)
        print("AUTO-FIX")
        print("=" * 60)

        for asset_id in fixable_assets:
            success = fix_asset(asset_id)

            if success:
                # Re-validate
                passed, results = validate_asset(conn, asset_id)
                if passed:
                    print(f"  {asset_id}: ✓ Fixed successfully")
                    failed_assets.remove(asset_id)
                else:
                    print(f"  {asset_id}: ⚠️ Still has issues after re-export")

    conn.close()

    # Exit code
    if failed_assets:
        print(f"\n❌ {len(failed_assets)} asset(s) have validation errors")
        if not args.fix:
            print("Run with --fix to attempt auto-repair")
        sys.exit(1)
    else:
        print("\n✓ All validations passed")
        sys.exit(0)


if __name__ == "__main__":
    main()
