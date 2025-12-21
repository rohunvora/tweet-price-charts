#!/usr/bin/env python3
"""
Add a new asset to the tweet-price tracker.

This script orchestrates the entire process:
1. Validates inputs (Twitter handle, CoinGecko ID, etc.)
2. Adds the asset to assets.json
3. Fetches tweets from the founder
4. Fetches price data
5. Computes statistics
6. Exports static files for the frontend
7. Caches the founder's avatar

Usage:
    # CoinGecko-listed token (simplest)
    python add_asset.py mytoken --name "My Token" --founder someuser --coingecko my-token-id

    # Solana DEX token (needs pool address)
    python add_asset.py mytoken --name "My Token" --founder someuser \\
        --network solana --pool 0x123... --mint 0xabc...

    # Update existing asset (re-fetch data)
    python add_asset.py mytoken --refresh

    # Validate only (don't add or fetch)
    python add_asset.py mytoken --name "My Token" --founder someuser --coingecko my-token-id --dry-run
"""
import argparse
import json
import subprocess
import sys
import time
import httpx
from pathlib import Path
from datetime import datetime
from typing import Optional

from config import (
    ASSETS_FILE,
    X_BEARER_TOKEN,
    X_API_BASE,
    PROJECT_ROOT,
    LOGOS_DIR,
)

# ANSI colors for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"


def print_step(msg: str):
    """Print a step header."""
    print(f"\n{BLUE}{BOLD}▶ {msg}{RESET}")


def print_success(msg: str):
    """Print a success message."""
    print(f"{GREEN}✓ {msg}{RESET}")


def print_error(msg: str):
    """Print an error message."""
    print(f"{RED}✗ {msg}{RESET}")


def print_warning(msg: str):
    """Print a warning message."""
    print(f"{YELLOW}⚠ {msg}{RESET}")


def validate_twitter_handle(username: str) -> tuple[bool, str]:
    """Check if Twitter handle exists. Returns (success, message)."""
    if not X_BEARER_TOKEN:
        return True, "Skipped (no X_BEARER_TOKEN)"

    url = f"{X_API_BASE}/users/by/username/{username}"
    headers = {"Authorization": f"Bearer {X_BEARER_TOKEN}"}

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                name = data.get("data", {}).get("name", username)
                return True, f"Found: {name} (@{username})"
            elif response.status_code == 404:
                return False, f"User @{username} not found"
            else:
                return False, f"Twitter API error: {response.status_code}"
    except Exception as e:
        return False, f"Network error: {e}"


def validate_coingecko_id(cg_id: str) -> tuple[bool, str]:
    """Check if CoinGecko ID exists. Returns (success, message)."""
    url = f"https://api.coingecko.com/api/v3/coins/{cg_id}"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url)
            if response.status_code == 200:
                data = response.json()
                name = data.get("name", cg_id)
                symbol = data.get("symbol", "").upper()
                return True, f"Found: {name} ({symbol})"
            elif response.status_code == 404:
                return False, f"CoinGecko ID '{cg_id}' not found"
            else:
                return False, f"CoinGecko API error: {response.status_code}"
    except Exception as e:
        return False, f"Network error: {e}"


def download_logo(asset_id: str, coingecko_id: str) -> tuple[bool, str]:
    """Download logo from CoinGecko and save as PNG. Returns (success, message)."""
    logo_path = LOGOS_DIR / f"{asset_id}.png"

    # Check if logo already exists
    if logo_path.exists():
        return True, f"Logo already exists: {logo_path.name}"

    if not coingecko_id:
        return False, "No CoinGecko ID provided for logo download"

    try:
        # Get logo URL from CoinGecko
        url = f"https://api.coingecko.com/api/v3/coins/{coingecko_id}"
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url)
            if response.status_code != 200:
                return False, f"CoinGecko API error: {response.status_code}"

            data = response.json()
            logo_url = data.get("image", {}).get("large")
            if not logo_url:
                return False, "No logo URL in CoinGecko response"

            # Download the image
            img_response = client.get(logo_url)
            if img_response.status_code != 200:
                return False, f"Failed to download logo: {img_response.status_code}"

            # Save temporarily
            temp_path = LOGOS_DIR / f"{asset_id}_temp"
            temp_path.write_bytes(img_response.content)

            # Convert to PNG using sips (macOS) or just save if already PNG
            import subprocess
            result = subprocess.run(
                ["sips", "-s", "format", "png", str(temp_path), "--out", str(logo_path)],
                capture_output=True,
                text=True
            )
            temp_path.unlink(missing_ok=True)

            if result.returncode != 0:
                # Fallback: just rename if sips fails (might already be PNG)
                if not logo_path.exists():
                    return False, f"Failed to convert logo to PNG: {result.stderr}"

            return True, f"Downloaded logo: {logo_path.name}"
    except Exception as e:
        return False, f"Error downloading logo: {e}"


def validate_logo(asset_id: str) -> tuple[bool, str]:
    """Check if logo exists for asset. Returns (success, message)."""
    logo_path = LOGOS_DIR / f"{asset_id}.png"
    if logo_path.exists():
        size_kb = logo_path.stat().st_size / 1024
        return True, f"Logo exists: {logo_path.name} ({size_kb:.1f} KB)"
    return False, f"Missing logo: web/public/logos/{asset_id}.png"


# =============================================================================
# DATA SOURCE DISCOVERY - Find source with longest price history
# =============================================================================

GT_API = "https://api.geckoterminal.com/api/v2"
CG_API = "https://api.coingecko.com/api/v3"

# Network name mappings for GeckoTerminal
GT_NETWORK_MAP = {
    "ethereum": "eth",
    "base": "base",
    "solana": "solana",
    "bsc": "bsc",
    "arbitrum": "arbitrum-one",
    "polygon": "polygon_pos",
    "optimism": "optimism",
    "avalanche": "avax",
}


def get_coingecko_info(cg_id: str) -> Optional[dict]:
    """Get full CoinGecko coin info including platforms/addresses."""
    url = f"{CG_API}/coins/{cg_id}"
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url)
            if response.status_code == 200:
                return response.json()
    except Exception:
        pass
    return None


def probe_coingecko_history(cg_id: str) -> dict:
    """
    Probe CoinGecko to find the oldest available price data.
    Returns dict with 'days_available', 'oldest_date', 'source'.
    """
    result = {
        "source": "coingecko",
        "coingecko_id": cg_id,
        "days_available": 0,
        "oldest_date": None,
        "error": None,
    }

    # CoinGecko market_chart endpoint with max days
    url = f"{CG_API}/coins/{cg_id}/market_chart"
    params = {"vs_currency": "usd", "days": "max"}

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                prices = data.get("prices", [])
                if prices:
                    oldest_ts = prices[0][0] / 1000  # CoinGecko uses milliseconds
                    newest_ts = prices[-1][0] / 1000
                    oldest_date = datetime.utcfromtimestamp(oldest_ts)
                    days = (newest_ts - oldest_ts) / 86400
                    result["days_available"] = int(days)
                    result["oldest_date"] = oldest_date.strftime("%Y-%m-%d")
            elif response.status_code == 429:
                result["error"] = "Rate limited"
            else:
                result["error"] = f"HTTP {response.status_code}"
    except Exception as e:
        result["error"] = str(e)

    return result


def discover_geckoterminal_pools(token_address: str, network: str) -> list[dict]:
    """
    Search GeckoTerminal for pools containing this token on a specific network.
    Returns list of pool info dicts.
    """
    gt_network = GT_NETWORK_MAP.get(network, network)
    url = f"{GT_API}/networks/{gt_network}/tokens/{token_address}/pools"
    params = {"page": 1}

    pools = []
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                for pool in data.get("data", [])[:5]:  # Top 5 pools by liquidity
                    attrs = pool.get("attributes", {})
                    pools.append({
                        "address": attrs.get("address"),
                        "name": attrs.get("name"),
                        "network": network,
                        "gt_network": gt_network,
                        "liquidity_usd": float(attrs.get("reserve_in_usd") or 0),
                    })
    except Exception:
        pass

    return pools


def probe_geckoterminal_history(network: str, pool_address: str) -> dict:
    """
    Probe GeckoTerminal to find the oldest available OHLCV data for a pool.
    Returns dict with 'days_available', 'oldest_date', 'source'.
    """
    gt_network = GT_NETWORK_MAP.get(network, network)
    result = {
        "source": "geckoterminal",
        "network": network,
        "pool_address": pool_address,
        "days_available": 0,
        "oldest_date": None,
        "error": None,
        "paywall_hit": False,
    }

    # Probe with daily candles going back in time
    url = f"{GT_API}/networks/{gt_network}/pools/{pool_address}/ohlcv/day"

    # Binary search to find oldest data - start with current time
    now_ts = int(datetime.utcnow().timestamp())
    oldest_found = now_ts

    try:
        with httpx.Client(timeout=30.0) as client:
            # First request to get recent data
            params = {"aggregate": 1, "limit": 1000}
            response = client.get(url, params=params)

            if response.status_code == 200:
                data = response.json()
                ohlcv = data.get("data", {}).get("attributes", {}).get("ohlcv_list", [])
                if ohlcv:
                    # ohlcv_list is [timestamp, o, h, l, c, v] sorted newest first
                    oldest_found = ohlcv[-1][0]

                    # Try to go further back with before_timestamp
                    for _ in range(5):  # Max 5 pages back
                        time.sleep(0.3)  # Rate limiting
                        params["before_timestamp"] = oldest_found
                        response = client.get(url, params=params)

                        if response.status_code == 401:
                            result["paywall_hit"] = True
                            break
                        elif response.status_code == 200:
                            data = response.json()
                            ohlcv = data.get("data", {}).get("attributes", {}).get("ohlcv_list", [])
                            if not ohlcv:
                                break
                            new_oldest = ohlcv[-1][0]
                            if new_oldest >= oldest_found:
                                break
                            oldest_found = new_oldest
                        else:
                            break

                    oldest_date = datetime.utcfromtimestamp(oldest_found)
                    days = (now_ts - oldest_found) / 86400
                    result["days_available"] = int(days)
                    result["oldest_date"] = oldest_date.strftime("%Y-%m-%d")

            elif response.status_code == 401:
                result["paywall_hit"] = True
                result["error"] = "180-day paywall"
            else:
                result["error"] = f"HTTP {response.status_code}"

    except Exception as e:
        result["error"] = str(e)

    return result


def discover_best_price_source(cg_id: str) -> list[dict]:
    """
    Given a CoinGecko ID, discover all available price sources and probe their history.
    Returns list of source options sorted by days_available (most history first).
    """
    sources = []

    print(f"  Discovering price sources for '{cg_id}'...")

    # 1. Get CoinGecko info (includes platform addresses)
    cg_info = get_coingecko_info(cg_id)
    if not cg_info:
        print_warning(f"  Could not fetch CoinGecko info")
        return sources

    platforms = cg_info.get("platforms", {})

    # 2. Probe CoinGecko history
    print(f"  Probing CoinGecko...")
    cg_result = probe_coingecko_history(cg_id)
    if cg_result["days_available"] > 0:
        sources.append(cg_result)
        print(f"    CoinGecko: {cg_result['days_available']} days (since {cg_result['oldest_date']})")
    else:
        print(f"    CoinGecko: {cg_result.get('error', 'No data')}")

    # 3. For each platform, find GeckoTerminal pools
    for platform, address in platforms.items():
        if not address or platform not in GT_NETWORK_MAP:
            continue

        print(f"  Searching {platform} pools...")
        time.sleep(0.3)  # Rate limiting

        pools = discover_geckoterminal_pools(address, platform)
        if not pools:
            print(f"    No pools found on {platform}")
            continue

        # Probe the top pool by liquidity
        top_pool = max(pools, key=lambda p: p["liquidity_usd"])
        print(f"    Found pool: {top_pool['name']} (${top_pool['liquidity_usd']:,.0f} liq)")

        time.sleep(0.3)
        gt_result = probe_geckoterminal_history(platform, top_pool["address"])
        gt_result["token_address"] = address
        gt_result["pool_name"] = top_pool["name"]
        gt_result["liquidity_usd"] = top_pool["liquidity_usd"]

        if gt_result["days_available"] > 0:
            sources.append(gt_result)
            paywall_note = " (paywall hit)" if gt_result["paywall_hit"] else ""
            print(f"    GeckoTerminal/{platform}: {gt_result['days_available']} days (since {gt_result['oldest_date']}){paywall_note}")
        else:
            print(f"    GeckoTerminal/{platform}: {gt_result.get('error', 'No data')}")

    # Sort by days available (most history first)
    sources.sort(key=lambda x: x["days_available"], reverse=True)

    return sources


def print_source_recommendations(sources: list[dict], launch_date: str = None):
    """Print a formatted comparison of discovered price sources."""
    if not sources:
        print_warning("  No price sources found!")
        return

    print(f"\n  {'Source':<25} {'Network':<12} {'History':<12} {'Oldest Date':<12}")
    print(f"  {'-'*25} {'-'*12} {'-'*12} {'-'*12}")

    for i, src in enumerate(sources):
        if src["source"] == "coingecko":
            name = "CoinGecko"
            network = "-"
        else:
            name = f"GeckoTerminal"
            network = src.get("network", "?")

        days = src["days_available"]
        oldest = src.get("oldest_date", "?")

        # Mark the recommended source
        marker = f"{GREEN}★{RESET}" if i == 0 else " "
        print(f"  {marker} {name:<23} {network:<12} {days:>4} days    {oldest}")

    # Check coverage against launch date
    if launch_date and sources:
        best = sources[0]
        launch_dt = datetime.strptime(launch_date[:10], "%Y-%m-%d")
        oldest_dt = datetime.strptime(best["oldest_date"], "%Y-%m-%d")

        if oldest_dt > launch_dt:
            gap_days = (oldest_dt - launch_dt).days
            print_warning(f"\n  Best source still missing {gap_days} days from launch ({launch_date[:10]})")


def load_assets() -> dict:
    """Load assets.json config."""
    with open(ASSETS_FILE) as f:
        return json.load(f)


def save_assets(config: dict):
    """Save assets.json config."""
    with open(ASSETS_FILE, "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")


def asset_exists(config: dict, asset_id: str) -> bool:
    """Check if asset already exists."""
    return any(a["id"] == asset_id for a in config.get("assets", []))


def add_asset_to_config(
    config: dict,
    asset_id: str,
    name: str,
    founder: str,
    coingecko_id: str = None,
    network: str = None,
    pool_address: str = None,
    token_mint: str = None,
    color: str = "#3B82F6",
    launch_date: str = None,
    founder_type: str = None,
    keyword_filter: str = None,
    tweet_filter_note: str = None,
) -> dict:
    """
    Add a new asset to the config.

    Args:
        founder_type: 'founder' (default) or 'adopter'. Adopters need keyword filtering.
        keyword_filter: For adopters, keyword to filter tweets (e.g., 'wif').
        tweet_filter_note: Description shown in UI (auto-generated if not provided).
    """

    # Determine price source based on inputs
    if network and pool_address:
        price_source = "geckoterminal"
        backfill_source = "birdeye" if network == "solana" else None
    elif coingecko_id:
        price_source = "coingecko"
        backfill_source = None
        network = network or "ethereum"  # Default for CoinGecko tokens
    else:
        raise ValueError("Must provide either coingecko_id or (network + pool_address)")

    asset = {
        "id": asset_id,
        "name": name,
        "founder": founder,
        "network": network,
        "pool_address": pool_address,
        "token_mint": token_mint,
        "coingecko_id": coingecko_id,
        "price_source": price_source,
        "backfill_source": backfill_source,
        "launch_date": launch_date or datetime.now().strftime("%Y-%m-%dT00:00:00Z"),
        "color": color,
        "enabled": True,
        "logo": f"/logos/{asset_id}.png",
    }

    # Add adopter-specific fields
    if founder_type == "adopter":
        asset["founder_type"] = "adopter"
        if keyword_filter:
            asset["keyword_filter"] = keyword_filter
            # Auto-generate filter note if not provided
            if tweet_filter_note:
                asset["tweet_filter_note"] = tweet_filter_note
            else:
                asset["tweet_filter_note"] = f"Only tweets mentioning ${name}"

    # Remove None values for cleaner JSON
    asset = {k: v for k, v in asset.items() if v is not None}

    config["assets"].append(asset)
    return config


def run_script(script_name: str, args: list = None) -> bool:
    """Run a Python script and return success status."""
    cmd = [sys.executable, str(PROJECT_ROOT / "scripts" / script_name)]
    if args:
        cmd.extend(args)

    try:
        result = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT / "scripts",
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout
        )

        if result.returncode != 0:
            print(f"  stdout: {result.stdout[-500:] if result.stdout else '(empty)'}")
            print(f"  stderr: {result.stderr[-500:] if result.stderr else '(empty)'}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print_error(f"Script timed out after 10 minutes")
        return False
    except Exception as e:
        print_error(f"Failed to run script: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Add a new asset to the tweet-price tracker",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # CoinGecko-listed token
  python add_asset.py mytoken --name "My Token" --founder user123 --coingecko my-token-id

  # Solana DEX token
  python add_asset.py mytoken --name "My Token" --founder user123 --network solana --pool 0x123...

  # Update existing asset
  python add_asset.py mytoken --refresh
        """,
    )

    parser.add_argument("asset_id", help="Unique asset ID (lowercase, no spaces)")
    parser.add_argument("--name", help="Display name for the asset")
    parser.add_argument("--founder", help="Twitter handle of the founder (without @)")
    parser.add_argument("--coingecko", dest="coingecko_id", help="CoinGecko ID for price data")
    parser.add_argument("--network", choices=["solana", "ethereum", "bsc", "base", "hyperliquid", "monad", "arbitrum", "polygon", "optimism", "avalanche"], help="Blockchain network")
    parser.add_argument("--pool", dest="pool_address", help="DEX pool address (for GeckoTerminal)")
    parser.add_argument("--mint", dest="token_mint", help="Token mint/contract address")
    parser.add_argument("--color", default="#3B82F6", help="Brand color (hex, default: #3B82F6)")
    parser.add_argument("--launch-date", help="Launch date (YYYY-MM-DD)")

    # Adopter-specific arguments
    # Use these when the tracked account didn't CREATE the token but became a prominent promoter.
    # Example: @blknoiz06 didn't create WIF but became its most notable promoter.
    parser.add_argument(
        "--founder-type",
        choices=["founder", "adopter"],
        default="founder",
        help="'founder' (default) if account created the token, 'adopter' if they promote an existing token"
    )
    parser.add_argument(
        "--keyword-filter",
        help="For adopters: keyword to filter tweets (e.g., 'wif'). Only tweets containing this are shown."
    )
    parser.add_argument(
        "--tweet-filter-note",
        help="For adopters: note explaining the filter (auto-generated if not provided)"
    )

    parser.add_argument("--refresh", action="store_true", help="Refresh data for existing asset")
    parser.add_argument("--dry-run", action="store_true", help="Validate only, don't add or fetch")
    parser.add_argument("--skip-tweets", action="store_true", help="Skip tweet fetching")
    parser.add_argument("--skip-prices", action="store_true", help="Skip price fetching")
    parser.add_argument("--discover", action="store_true", help="Discover best price source (probe all available sources)")
    parser.add_argument("--auto-best", action="store_true", help="Automatically use the best discovered source")

    args = parser.parse_args()

    print("=" * 60)
    print(f"{BOLD}Add Asset: {args.asset_id}{RESET}")
    print("=" * 60)

    # Load existing config
    config = load_assets()
    exists = asset_exists(config, args.asset_id)

    # Handle refresh mode
    if args.refresh:
        if not exists:
            print_error(f"Asset '{args.asset_id}' not found. Use without --refresh to add it.")
            sys.exit(1)
        print(f"Refreshing existing asset: {args.asset_id}")
    else:
        # Validate required fields for new asset
        if exists:
            print_error(f"Asset '{args.asset_id}' already exists. Use --refresh to update it.")
            sys.exit(1)

        if not args.name:
            print_error("--name is required for new assets")
            sys.exit(1)
        if not args.founder:
            print_error("--founder is required for new assets")
            sys.exit(1)
        if not args.coingecko_id and not args.pool_address:
            print_error("Must provide --coingecko or --pool for price data")
            sys.exit(1)

        # Validate adopter-specific requirements
        if args.founder_type == "adopter" and not args.keyword_filter:
            print_error("--keyword-filter is required for adopter assets")
            print("  Adopters need keyword filtering because most of their tweets aren't about the token.")
            print("  Example: --keyword-filter wif")
            sys.exit(1)

    # Validation step
    print_step("Validating inputs")

    if not args.refresh:
        # Validate Twitter handle
        print(f"  Checking Twitter handle @{args.founder}...")
        success, msg = validate_twitter_handle(args.founder)
        if success:
            print_success(f"  {msg}")
        else:
            print_error(f"  {msg}")
            sys.exit(1)

        # Validate CoinGecko ID if provided
        if args.coingecko_id:
            print(f"  Checking CoinGecko ID '{args.coingecko_id}'...")
            success, msg = validate_coingecko_id(args.coingecko_id)
            if success:
                print_success(f"  {msg}")
            else:
                print_error(f"  {msg}")
                sys.exit(1)

        # Validate pool address format if provided
        if args.pool_address:
            if not args.network:
                print_error("--network is required when using --pool")
                sys.exit(1)
            print_success(f"  Pool: {args.pool_address[:20]}... on {args.network}")

    # Data source discovery (when --discover or --auto-best)
    discovered_sources = []
    best_source = None

    if (args.discover or args.auto_best) and args.coingecko_id and not args.refresh:
        print_step("Discovering price sources")
        discovered_sources = discover_best_price_source(args.coingecko_id)
        print_source_recommendations(discovered_sources, args.launch_date)

        if discovered_sources:
            best_source = discovered_sources[0]

            if args.auto_best and best_source["source"] == "geckoterminal":
                # Override args with best source
                print(f"\n  {GREEN}Auto-selecting best source: GeckoTerminal/{best_source['network']}{RESET}")
                args.network = best_source["network"]
                args.pool_address = best_source["pool_address"]
                if "token_address" in best_source:
                    args.token_mint = best_source["token_address"]
            elif args.auto_best and best_source["source"] == "coingecko":
                print(f"\n  {GREEN}Auto-selecting best source: CoinGecko{RESET}")
                # CoinGecko is already the default when only coingecko_id is provided

    if args.dry_run or args.discover:
        if args.discover and not args.dry_run:
            print_success("\nDiscovery complete!")
            if discovered_sources:
                best = discovered_sources[0]
                if best["source"] == "geckoterminal":
                    print(f"\nTo use the best source, run:")
                    print(f"  python add_asset.py {args.asset_id} --name \"{args.name}\" --founder {args.founder} \\")
                    print(f"    --coingecko {args.coingecko_id} --network {best['network']} --pool {best['pool_address']}")
                    if args.launch_date:
                        print(f"    --launch-date {args.launch_date}")
                print(f"\nOr use --auto-best to automatically select the best source.")
            sys.exit(0)
        print_success("\nDry run complete - validation passed!")
        print("Run without --dry-run to add the asset and fetch data.")
        sys.exit(0)

    # Add to config (if new)
    if not args.refresh:
        print_step("Adding to assets.json")

        launch_date = None
        if args.launch_date:
            launch_date = f"{args.launch_date}T00:00:00Z"

        config = add_asset_to_config(
            config,
            args.asset_id,
            args.name,
            args.founder,
            coingecko_id=args.coingecko_id,
            network=args.network,
            pool_address=args.pool_address,
            token_mint=args.token_mint,
            color=args.color,
            launch_date=launch_date,
            founder_type=args.founder_type,
            keyword_filter=args.keyword_filter,
            tweet_filter_note=args.tweet_filter_note,
        )
        save_assets(config)
        print_success(f"Added {args.asset_id} to assets.json")

    # Run pipeline scripts
    steps = []

    if not args.skip_tweets:
        steps.append(("Fetching tweets", "fetch_tweets.py", ["--asset", args.asset_id]))

    if not args.skip_prices:
        steps.append(("Fetching prices", "fetch_prices.py", ["--asset", args.asset_id]))

    steps.extend([
        ("Computing statistics", "compute_stats.py", ["--asset", args.asset_id]),
        ("Exporting static files", "export_static.py", ["--asset", args.asset_id]),
        ("Caching avatar", "cache_avatars.py", ["--asset", args.asset_id]),
    ])

    failed = False
    for step_name, script, script_args in steps:
        print_step(step_name)
        if run_script(script, script_args):
            print_success(f"  {step_name} complete")
        else:
            print_error(f"  {step_name} failed")
            failed = True
            # Continue with other steps even if one fails

    # Download logo from CoinGecko if available
    logo_downloaded = False
    coingecko_id = args.coingecko_id
    if not coingecko_id and args.refresh:
        # Try to get CoinGecko ID from existing config for refresh
        asset_config = next((a for a in config.get("assets", []) if a["id"] == args.asset_id), None)
        if asset_config:
            coingecko_id = asset_config.get("coingecko_id")

    if coingecko_id:
        print_step("Downloading logo")
        success, msg = download_logo(args.asset_id, coingecko_id)
        if success:
            print_success(f"  {msg}")
            logo_downloaded = True
        else:
            print_warning(f"  {msg}")

    # Validate logo exists
    if not logo_downloaded:
        success, msg = validate_logo(args.asset_id)
        if success:
            logo_downloaded = True
        else:
            print_warning(f"  {msg}")

    # Check if asset is old enough to need Nitter backfill
    needs_nitter_guidance = False
    launch_age_days = 0
    if args.launch_date and not args.refresh:
        try:
            launch_dt = datetime.strptime(args.launch_date[:10], "%Y-%m-%d")
            launch_age_days = (datetime.now() - launch_dt).days
            needs_nitter_guidance = launch_age_days > 150
        except ValueError:
            pass

    is_adopter = args.founder_type == "adopter" if hasattr(args, 'founder_type') else False

    # Summary
    print("\n" + "=" * 60)
    if failed:
        print(f"{YELLOW}⚠ Asset added with some errors{RESET}")
        print("Check the output above for details.")
        print("You may need to re-run with --refresh after fixing issues.")
    else:
        print(f"{GREEN}{BOLD}✓ Asset '{args.asset_id}' added successfully!{RESET}")
        print(f"\nNext steps:")
        step_num = 1

        if not logo_downloaded:
            print(f"  {step_num}. Add a logo to: web/public/logos/{args.asset_id}.png")
            step_num += 1

        # Nitter backfill guidance for old assets
        if needs_nitter_guidance:
            print(f"\n  {YELLOW}{BOLD}Historical tweet backfill needed:{RESET}")
            print(f"  Asset launched {launch_age_days} days ago, but X API only provides ~150 days.")
            print(f"  {step_num}. Run Nitter scraper for historical tweets:")
            print(f"     cd scripts")
            print(f"     python nitter_scraper.py --asset {args.asset_id} --full --no-headless --parallel 3")
            print(f"     python export_static.py --asset {args.asset_id}")
            step_num += 1

        # Adopter guidance
        if is_adopter:
            print(f"\n  {BLUE}Note for adopter asset:{RESET}")
            print(f"  - Tweets are filtered by keyword: '{args.keyword_filter}'")
            print(f"  - Most tweets from @{args.founder} won't appear (not about this token)")
            if needs_nitter_guidance:
                print(f"  - Nitter scrape is especially useful for finding early mentions")

        print(f"\n  {step_num}. Commit and push to deploy")
        print(f"     git add -A && git commit -m 'Add asset: {args.name or args.asset_id}'")
        print(f"     git push")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
