"""
Nitter Scraper v2 - Robust tweet backfill via Nitter.

LESSONS LEARNED from v1:
- nitter.net rate limits after rapid requests → net::ERR_HTTP_RESPONSE_CODE_FAILURE
- 5s delay between chunks is NOT enough
- Single instance = single point of failure
- No retry logic means lost progress

V2 IMPROVEMENTS:
1. Much longer delays (30-60s between chunks)
2. Exponential backoff retry with up to 5 attempts per chunk
3. Instance rotation (nitter.net → nitter.poast.org fallback)
4. Randomized delays to appear human-like
5. Keep browser session open across chunks (reduces detection)
6. Progress tracking for resumability
7. Detailed logging for debugging

Usage:
    # Backfill all missing tweets
    python nitter_scraper_v2.py --asset useless --full
    
    # Specific date range
    python nitter_scraper_v2.py --asset useless --since 2025-06-01 --until 2025-07-01
    
    # Resume from last failure
    python nitter_scraper_v2.py --asset useless --resume
"""
import argparse
import json
import re
import sys
import time
import random
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

# Add scripts dir to path for imports
SCRIPTS_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPTS_DIR))

from db import (
    get_connection, init_schema, get_asset, load_assets_from_json,
    insert_tweets, get_ingestion_state, update_ingestion_state
)

# Check for playwright
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout, Browser, BrowserContext, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False


# =============================================================================
# CONFIGURATION - TUNED FOR RELIABILITY
# =============================================================================

# Instance list - rotate on failure
NITTER_INSTANCES = [
    "https://nitter.net",
    "https://nitter.poast.org",
]

# Timing - MUCH more conservative than v1
MIN_CHUNK_DELAY = 30  # Minimum 30 seconds between chunks
MAX_CHUNK_DELAY = 60  # Maximum 60 seconds between chunks
MIN_PAGE_DELAY = 3    # Minimum 3 seconds between pagination clicks
MAX_PAGE_DELAY = 6    # Maximum 6 seconds between pagination clicks

# Retry configuration
MAX_RETRIES = 5              # Retry each chunk up to 5 times
INITIAL_RETRY_DELAY = 60     # Start with 60 second delay
RETRY_BACKOFF_FACTOR = 1.5   # Multiply delay by 1.5 each retry

# Timeouts
PAGE_LOAD_TIMEOUT = 45000    # 45 seconds for page load
TWEET_WAIT_TIMEOUT = 20000   # 20 seconds to wait for tweets
CLOUDFLARE_WAIT = 5          # 5 seconds for Cloudflare challenges

# Chunk settings
DEFAULT_CHUNK_DAYS = 7       # 7 days per chunk (smaller = safer)
MAX_TWEETS_PER_CHUNK = 500   # Safety limit
MAX_PAGES_PER_CHUNK = 20     # Pagination safety limit

# Progress file for resumability
PROGRESS_FILE = Path(__file__).parent.parent / "data" / "nitter_progress.json"


# =============================================================================
# LOGGING
# =============================================================================

def log(msg: str, level: str = "INFO"):
    """Log with timestamp and level."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    prefix = {
        "INFO": "ℹ️ ",
        "OK": "✅ ",
        "WARN": "⚠️ ",
        "ERROR": "❌ ",
        "DEBUG": "🔍 ",
        "WAIT": "⏳ ",
    }.get(level, "")
    print(f"[{timestamp}] {prefix}{msg}", flush=True)


# =============================================================================
# PROGRESS TRACKING
# =============================================================================

def load_progress() -> Dict:
    """Load progress from file."""
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text())
        except:
            pass
    return {}


def save_progress(progress: Dict):
    """Save progress to file."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2, default=str))


def get_completed_chunks(asset_id: str) -> set:
    """Get set of completed chunk date ranges."""
    progress = load_progress()
    return set(progress.get(asset_id, {}).get("completed_chunks", []))


def mark_chunk_complete(asset_id: str, chunk_key: str):
    """Mark a chunk as completed."""
    progress = load_progress()
    if asset_id not in progress:
        progress[asset_id] = {"completed_chunks": []}
    if chunk_key not in progress[asset_id]["completed_chunks"]:
        progress[asset_id]["completed_chunks"].append(chunk_key)
    save_progress(progress)


def clear_progress(asset_id: str):
    """Clear progress for an asset."""
    progress = load_progress()
    if asset_id in progress:
        del progress[asset_id]
        save_progress(progress)


# =============================================================================
# DATE PARSING
# =============================================================================

def parse_nitter_date(title_attr: str) -> Optional[datetime]:
    """
    Parse Nitter's date title attribute to datetime.
    Format: "Dec 17, 2024 · 3:45 PM UTC" or similar variants.
    """
    if not title_attr:
        return None
    
    # Clean up the string
    clean = title_attr.replace('·', '').strip()
    clean = re.sub(r'\s+', ' ', clean)  # Normalize whitespace
    
    # Try various formats
    formats = [
        "%b %d, %Y %I:%M %p UTC",
        "%b %d, %Y %I:%M %p",
        "%d %b %Y %I:%M %p UTC",
        "%d %b %Y %I:%M %p",
        "%b %d, %Y %H:%M UTC",
        "%b %d, %Y %H:%M",
    ]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(clean, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    
    return None


def extract_tweet_id(link: str) -> Optional[str]:
    """Extract tweet ID from Nitter link like '/user/status/123456789'"""
    match = re.search(r'/status/(\d+)', link)
    return match.group(1) if match else None


def parse_stat_number(text: str) -> int:
    """Parse stat number, handling K/M suffixes and commas."""
    if not text:
        return 0
    
    text = text.strip().replace(',', '')
    
    multiplier = 1
    if text.endswith('K'):
        multiplier = 1000
        text = text[:-1]
    elif text.endswith('M'):
        multiplier = 1000000
        text = text[:-1]
    
    try:
        return int(float(text) * multiplier)
    except (ValueError, TypeError):
        return 0


# =============================================================================
# SCRAPER CORE
# =============================================================================

def wait_random(min_sec: float, max_sec: float, reason: str = ""):
    """Wait a random amount of time."""
    delay = random.uniform(min_sec, max_sec)
    if reason:
        log(f"Waiting {delay:.1f}s - {reason}", "WAIT")
    time.sleep(delay)


def handle_cloudflare(page: Page) -> bool:
    """
    Handle Cloudflare challenge if present.
    Returns True if challenge was resolved or not present.
    """
    try:
        # Check for Cloudflare challenge indicators
        content = page.content().lower()
        if 'verifying' in content or 'cloudflare' in content or 'checking your browser' in content:
            log("Cloudflare challenge detected, waiting...", "WAIT")
            time.sleep(CLOUDFLARE_WAIT)
            
            # Wait for challenge to resolve
            for _ in range(10):  # Max 10 attempts
                content = page.content().lower()
                if 'verifying' not in content and 'cloudflare' not in content:
                    log("Cloudflare challenge passed", "OK")
                    return True
                time.sleep(2)
            
            log("Cloudflare challenge did not resolve", "WARN")
            return False
        
        return True
    except Exception as e:
        log(f"Error checking Cloudflare: {e}", "WARN")
        return True  # Continue anyway


def extract_tweets_from_page(page: Page, target_username: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Extract all tweets from the current page state.
    Returns list of tweet dicts in db.insert_tweets() format.
    
    Args:
        page: Playwright page object
        target_username: If provided, only include tweets from this user (without @)
    """
    tweets = []
    seen_ids = set()
    
    try:
        tweet_elements = page.query_selector_all('.timeline-item')
        
        for el in tweet_elements:
            try:
                # Skip non-tweet items
                classes = el.get_attribute('class') or ''
                if 'show-more' in classes:
                    continue
                
                # Get tweet link and extract ID
                date_link = el.query_selector('.tweet-date a')
                if not date_link:
                    continue
                
                href = date_link.get_attribute('href') or ''
                tweet_id = extract_tweet_id(href)
                
                if not tweet_id or tweet_id in seen_ids:
                    continue
                
                # Skip retweets
                if el.query_selector('.retweet-header'):
                    continue
                
                # Skip replies
                if el.query_selector('.replying-to'):
                    continue
                
                # IMPORTANT: Filter by author username
                if target_username:
                    # Get the username from the tweet header
                    # Try multiple selectors as Nitter HTML can vary
                    username_el = el.query_selector('.tweet-header .username')
                    if not username_el:
                        username_el = el.query_selector('.username')
                    
                    if username_el:
                        tweet_username = username_el.inner_text().strip().lstrip('@').lower()
                        if tweet_username != target_username.lower():
                            # This tweet is from a different user (e.g., a quote tweet)
                            continue
                    else:
                        # Can't determine username from selector - check URL as fallback
                        if f"/{target_username.lower()}/status/" not in href.lower():
                            continue
                
                seen_ids.add(tweet_id)
                
                # Get date
                date_title = date_link.get_attribute('title') or ''
                tweet_dt = parse_nitter_date(date_title)
                
                if not tweet_dt:
                    continue
                
                # Get text
                text_el = el.query_selector('.tweet-content')
                text = text_el.inner_text().strip() if text_el else ""
                
                # Get stats
                stats = {'replies': 0, 'retweets': 0, 'likes': 0, 'impressions': 0}
                
                stat_elements = el.query_selector_all('.tweet-stat')
                for stat_el in stat_elements:
                    stat_text = stat_el.inner_text().strip()
                    stat_val = parse_stat_number(stat_text)
                    
                    icon = stat_el.query_selector('.icon-comment, .icon-retweet, .icon-heart, .icon-chart')
                    if icon:
                        icon_class = icon.get_attribute('class') or ''
                        if 'comment' in icon_class:
                            stats['replies'] = stat_val
                        elif 'retweet' in icon_class:
                            stats['retweets'] = stat_val
                        elif 'heart' in icon_class:
                            stats['likes'] = stat_val
                        elif 'chart' in icon_class:
                            stats['impressions'] = stat_val
                
                # Build tweet in db format
                tweet = {
                    'id': tweet_id,
                    'text': text,
                    'timestamp': tweet_dt,
                    'created_at': tweet_dt.isoformat().replace('+00:00', 'Z'),
                    'likes': stats['likes'],
                    'retweets': stats['retweets'],
                    'replies': stats['replies'],
                    'impressions': stats['impressions'],
                }
                
                tweets.append(tweet)
                
            except Exception as e:
                log(f"Error parsing tweet: {e}", "DEBUG")
                continue
    
    except Exception as e:
        log(f"Error extracting tweets: {e}", "ERROR")
    
    return tweets


def scrape_chunk_with_context(
    context: BrowserContext,
    instance: str,
    username: str,
    since: str,
    until: str,
    keyword: Optional[str] = None,
    max_tweets: int = MAX_TWEETS_PER_CHUNK,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Scrape a single date chunk using existing browser context.
    
    Returns:
        (list of tweets, success boolean)
    """
    from urllib.parse import quote_plus
    
    query = quote_plus(keyword) if keyword else ""
    url = f"{instance}/{username}/search?f=tweets&q={query}&since={since}&until={until}"
    
    log(f"Scraping: {since} to {until} via {instance.split('//')[1]}", "INFO")
    
    all_tweets = []
    seen_ids = set()
    page = None
    
    try:
        page = context.new_page()
        page.goto(url, timeout=PAGE_LOAD_TIMEOUT)
        
        # Handle Cloudflare
        if not handle_cloudflare(page):
            page.close()
            return [], False
        
        # Wait for content
        try:
            page.wait_for_selector('.timeline-item, .error-panel', timeout=TWEET_WAIT_TIMEOUT)
        except PlaywrightTimeout:
            log("No tweets found for date range (timeout)", "INFO")
            page.close()
            return [], True  # Empty but successful
        
        # Check for error panel
        error = page.query_selector('.error-panel')
        if error:
            error_text = error.inner_text()
            if "No items found" in error_text:
                log("No tweets in this range", "INFO")
                page.close()
                return [], True
            else:
                log(f"Error panel: {error_text}", "WARN")
                page.close()
                return [], False
        
        # Paginate and collect tweets
        pages_scraped = 0
        empty_pages = 0  # Track consecutive pages with no new tweets
        MAX_EMPTY_PAGES = 3  # Stop after 3 consecutive empty pages
        
        while len(all_tweets) < max_tweets and pages_scraped < MAX_PAGES_PER_CHUNK:
            pages_scraped += 1
            
            # Extract tweets from current page (filtered by username)
            new_tweets = extract_tweets_from_page(page, target_username=username)
            added = 0
            
            for t in new_tweets:
                if t['id'] not in seen_ids:
                    seen_ids.add(t['id'])
                    all_tweets.append(t)
                    added += 1
            
            log(f"  Page {pages_scraped}: +{added} tweets (total: {len(all_tweets)})", "DEBUG")
            
            # Track empty pages
            if added == 0:
                empty_pages += 1
                if empty_pages >= MAX_EMPTY_PAGES:
                    log(f"  Stopping after {MAX_EMPTY_PAGES} empty pages", "DEBUG")
                    break
            else:
                empty_pages = 0  # Reset on successful page
            
            if len(all_tweets) >= max_tweets:
                break
            
            # Check for "Load more" button
            load_more = page.query_selector('.show-more a')
            if not load_more:
                break
            
            try:
                load_more.click()
                wait_random(MIN_PAGE_DELAY, MAX_PAGE_DELAY, "pagination")
                page.wait_for_selector('.timeline-item', timeout=10000)
            except Exception as e:
                log(f"Pagination ended: {e}", "DEBUG")
                break
        
        page.close()
        return all_tweets, True
        
    except PlaywrightTimeout:
        log("Page load timeout", "WARN")
        if page:
            page.close()
        return [], False
    except Exception as e:
        log(f"Scrape error: {e}", "ERROR")
        if page:
            page.close()
        return [], False


def scrape_chunk_with_retry(
    context: BrowserContext,
    username: str,
    since: str,
    until: str,
    keyword: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Scrape a chunk with retry logic and instance rotation.
    """
    retry_delay = INITIAL_RETRY_DELAY
    
    for attempt in range(MAX_RETRIES):
        # Rotate instances
        instance = NITTER_INSTANCES[attempt % len(NITTER_INSTANCES)]
        
        if attempt > 0:
            log(f"Retry {attempt}/{MAX_RETRIES} after {retry_delay:.0f}s delay", "WAIT")
            time.sleep(retry_delay)
            retry_delay *= RETRY_BACKOFF_FACTOR
        
        tweets, success = scrape_chunk_with_context(
            context=context,
            instance=instance,
            username=username,
            since=since,
            until=until,
            keyword=keyword,
        )
        
        if success:
            return tweets, True
    
    log(f"Chunk failed after {MAX_RETRIES} retries", "ERROR")
    return [], False


# =============================================================================
# MAIN ORCHESTRATION
# =============================================================================

def scrape_asset(
    asset_id: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
    keyword: Optional[str] = None,
    full: bool = False,
    resume: bool = True,
    chunk_days: int = DEFAULT_CHUNK_DAYS,
    headless: bool = False,
) -> Dict[str, Any]:
    """
    Main entry point for scraping an asset's tweets.
    
    Args:
        asset_id: Asset ID from assets.json
        since: Start date YYYY-MM-DD (optional)
        until: End date YYYY-MM-DD (optional)
        keyword: Keyword filter (uses asset config if None)
        full: Scrape from launch to now
        resume: Skip already-completed chunks
        chunk_days: Days per chunk
        headless: Run browser headless
    
    Returns:
        Summary dict with status and stats
    """
    if not PLAYWRIGHT_AVAILABLE:
        return {'status': 'error', 'reason': 'Playwright not installed'}
    
    # Load asset config
    conn = get_connection()
    init_schema(conn)
    load_assets_from_json(conn)
    
    asset = get_asset(conn, asset_id)
    if not asset:
        conn.close()
        return {'status': 'error', 'reason': f"Asset '{asset_id}' not found"}
    
    username = asset['founder']
    launch_date = asset['launch_date']
    
    # Use keyword from args, or fall back to asset config
    effective_keyword = keyword if keyword is not None else asset.get('keyword_filter')
    
    if isinstance(launch_date, str):
        launch_date = datetime.fromisoformat(launch_date.replace('Z', '+00:00'))
    if launch_date.tzinfo is None:
        launch_date = launch_date.replace(tzinfo=timezone.utc)
    
    log(f"Asset: {asset['name']} (@{username})", "INFO")
    log(f"Launch: {launch_date.date()}", "INFO")
    if effective_keyword:
        log(f"Keyword filter: \"{effective_keyword}\"", "INFO")
    
    # Determine date range
    if since and until:
        since_dt = datetime.strptime(since, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        until_dt = datetime.strptime(until, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    elif full:
        since_dt = launch_date
        until_dt = datetime.now(timezone.utc)
    else:
        # Backfill mode: from launch to oldest tweet
        oldest = conn.execute("""
            SELECT MIN(timestamp) FROM tweets WHERE asset_id = ?
        """, [asset_id]).fetchone()[0]
        
        if oldest:
            since_dt = launch_date
            until_dt = oldest if isinstance(oldest, datetime) else datetime.fromisoformat(str(oldest))
            if until_dt.tzinfo is None:
                until_dt = until_dt.replace(tzinfo=timezone.utc)
        else:
            since_dt = launch_date
            until_dt = datetime.now(timezone.utc)
    
    # Clamp dates
    if since_dt < launch_date:
        since_dt = launch_date
    now = datetime.now(timezone.utc)
    if until_dt > now:
        until_dt = now
    
    if since_dt >= until_dt:
        log("No date range to scrape", "INFO")
        conn.close()
        return {'status': 'skipped', 'reason': 'No date range'}
    
    # Generate chunks
    chunks = []
    current = since_dt
    while current < until_dt:
        chunk_end = min(current + timedelta(days=chunk_days), until_dt)
        chunk_key = f"{current.strftime('%Y-%m-%d')}_{chunk_end.strftime('%Y-%m-%d')}"
        chunks.append({
            'since': current.strftime('%Y-%m-%d'),
            'until': chunk_end.strftime('%Y-%m-%d'),
            'key': chunk_key,
        })
        current = chunk_end
    
    # Filter completed chunks if resuming
    completed = get_completed_chunks(asset_id) if resume else set()
    pending_chunks = [c for c in chunks if c['key'] not in completed]
    
    log(f"Total chunks: {len(chunks)}, Pending: {len(pending_chunks)}", "INFO")
    log("=" * 60)
    
    # Scrape with persistent browser
    total_tweets = 0
    total_inserted = 0
    failed_chunks = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
        )
        
        context = browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        for i, chunk in enumerate(pending_chunks, 1):
            log(f"\nChunk {i}/{len(pending_chunks)}: {chunk['since']} to {chunk['until']}", "INFO")
            
            tweets, success = scrape_chunk_with_retry(
                context=context,
                username=username,
                since=chunk['since'],
                until=chunk['until'],
                keyword=effective_keyword,
            )
            
            if success:
                # Filter pre-launch tweets
                tweets = [t for t in tweets if t['timestamp'] >= launch_date]
                
                if tweets:
                    inserted = insert_tweets(conn, asset_id, tweets)
                    total_tweets += len(tweets)
                    total_inserted += inserted
                    log(f"Found {len(tweets)} tweets, inserted {inserted} new", "OK")
                else:
                    log("No tweets in this chunk", "INFO")
                
                mark_chunk_complete(asset_id, chunk['key'])
            else:
                failed_chunks.append(chunk['key'])
                log(f"Chunk failed: {chunk['key']}", "ERROR")
            
            # Delay before next chunk
            if i < len(pending_chunks):
                wait_random(MIN_CHUNK_DELAY, MAX_CHUNK_DELAY, "before next chunk")
        
        browser.close()
    
    # Summary
    log("\n" + "=" * 60)
    log("SUMMARY", "INFO")
    log(f"  Chunks processed: {len(pending_chunks)}", "INFO")
    log(f"  Chunks failed: {len(failed_chunks)}", "INFO")
    log(f"  Tweets found: {total_tweets}", "INFO")
    log(f"  Tweets inserted: {total_inserted}", "INFO")
    
    if failed_chunks:
        log(f"  Failed chunks: {failed_chunks}", "WARN")
    
    conn.close()
    
    return {
        'status': 'success' if not failed_chunks else 'partial',
        'asset': asset_id,
        'username': username,
        'date_range': f"{since_dt.date()} to {until_dt.date()}",
        'chunks_total': len(chunks),
        'chunks_pending': len(pending_chunks),
        'chunks_failed': len(failed_chunks),
        'tweets_found': total_tweets,
        'tweets_inserted': total_inserted,
        'failed_chunks': failed_chunks,
    }


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Nitter Scraper v2 - Robust tweet backfill',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full backfill from launch to now
  python nitter_scraper_v2.py --asset useless --full
  
  # Specific date range
  python nitter_scraper_v2.py --asset useless --since 2025-06-01 --until 2025-07-01
  
  # Resume after interruption (skips completed chunks)
  python nitter_scraper_v2.py --asset useless --full
  
  # Start fresh (clear progress)
  python nitter_scraper_v2.py --asset useless --full --no-resume
  
  # Non-headless mode (shows browser)
  python nitter_scraper_v2.py --asset useless --full --no-headless
"""
    )
    
    parser.add_argument('--asset', '-a', required=True, help='Asset ID from assets.json')
    parser.add_argument('--since', '-s', help='Start date YYYY-MM-DD')
    parser.add_argument('--until', '-u', help='End date YYYY-MM-DD')
    parser.add_argument('--keyword', '-k', help='Keyword filter')
    parser.add_argument('--full', '-f', action='store_true', help='Full scrape from launch to now')
    parser.add_argument('--no-resume', action='store_true', help='Start fresh, ignore progress')
    parser.add_argument('--chunk-days', type=int, default=DEFAULT_CHUNK_DAYS, help=f'Days per chunk (default: {DEFAULT_CHUNK_DAYS})')
    parser.add_argument('--headless', action='store_true', help='Run headless (more likely to fail)')
    parser.add_argument('--no-headless', action='store_true', help='Show browser (recommended)')
    parser.add_argument('--clear-progress', action='store_true', help='Clear progress for asset and exit')
    
    args = parser.parse_args()
    
    if args.clear_progress:
        clear_progress(args.asset)
        print(f"Cleared progress for {args.asset}")
        return
    
    if not (args.since and args.until) and not args.full:
        print("ERROR: Must specify --since/--until or --full")
        parser.print_help()
        sys.exit(1)
    
    if not PLAYWRIGHT_AVAILABLE:
        print("ERROR: Playwright not installed. Run:")
        print("  pip install playwright")
        print("  playwright install chromium")
        sys.exit(1)
    
    # Determine headless mode
    headless = args.headless and not args.no_headless
    
    result = scrape_asset(
        asset_id=args.asset,
        since=args.since,
        until=args.until,
        keyword=args.keyword,
        full=args.full,
        resume=not args.no_resume,
        chunk_days=args.chunk_days,
        headless=headless,
    )
    
    print(f"\n[RESULT] {json.dumps(result, indent=2)}")
    
    if result['status'] == 'error':
        sys.exit(1)


if __name__ == '__main__':
    main()

