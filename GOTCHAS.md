# GOTCHAS.md - Read Before Changing ANYTHING

This file documents non-obvious design decisions and past debugging sessions.
**AI agents and developers: Read this BEFORE modifying any code.**

---

## Critical: Things That Will Crash the Frontend

### DST Duplicate Timestamps (export_static.py)

**Symptom:** Chart crashes with "Value is null" error from lightweight-charts.

**Root Cause:** Database stores datetime values. During DST "fall back" transitions,
two different wall-clock times (e.g., 2:00 AM before and after the change) can map
to the **same Unix timestamp**. lightweight-charts requires strictly unique timestamps.

**Solution:** export_static.py deduplicates timestamps during export, keeping the first
occurrence. There's a safety check that raises ValueError if duplicates slip through.

```python
# DO NOT REMOVE this deduplication logic in export_timeframe() and export_1m_chunked()
if ts_epoch in seen_timestamps:
    duplicates_skipped += 1
    continue
seen_timestamps.add(ts_epoch)
```

**Fixed in:** December 2024 after JUP chart started crashing.

---

## Database: Non-Obvious Design Decisions

### Staleness Limits in tweet_events View (db.py:139-142)

**What it does:** Each timeframe has a staleness limit:
- 1m: max 1 hour old
- 1h: max 24 hours old
- 1d: max 7 days old

**Why this exists:** Without staleness limits, a tweet from TODAY could match with
1-minute price data from 3 MONTHS AGO (when 1m collection started) instead of using
fresh 1h or 1d data. This caused wildly incorrect price_at_tweet values.

**DO NOT "optimize" by removing staleness checks.**

### CASE Statement Ordering (db.py:178-179)

```sql
CASE p.timeframe WHEN '1m' THEN 1 WHEN '1h' THEN 2 WHEN '1d' THEN 3 END
```

**DO NOT reorder this.** The fallback priority (1m > 1h > 1d) is intentional.
Changing the order breaks price lookups for tweets.

### Prices Table PRIMARY KEY (db.py:95)

```sql
PRIMARY KEY (asset_id, timeframe, timestamp)
```

The upsert logic in `insert_prices()` depends on this composite key.
**DO NOT change this** without also updating all INSERT...ON CONFLICT statements.

### insert_tweets Uses ON CONFLICT DO UPDATE (db.py:533-541)

This is intentional - we WANT to update engagement metrics (likes, retweets)
on re-fetch while preserving the original timestamp. Using INSERT OR IGNORE
would discard updated metrics.

### launch_date Filter in tweet_events (db.py:161)

```sql
WHERE t.timestamp >= a.launch_date
```

This prevents showing tweets from BEFORE the token existed.
**DO NOT remove this filter.**

---

## API Quirks: Know Before You Fetch

### GeckoTerminal Only Supports Backward Pagination (fetch_prices.py)

GeckoTerminal API only accepts `before_timestamp`, not `after_timestamp`.
You MUST paginate backwards from present to past.

**Why this matters for incremental fetch:**
You can't say "give me everything after timestamp X". Instead, you must:
1. Fetch the most recent page
2. Check if any returned candles are older than your last known timestamp
3. Stop when you hit existing data

**DO NOT try to add `after_timestamp` - the API doesn't support it.**

### GeckoTerminal 180-Day Paywall (fetch_prices.py:396-398)

Free tier returns HTTP 401 for data older than ~180 days.
Code handles this gracefully by returning empty list.

### X API 150-Day Historical Limit

X API v2 cannot retrieve tweets older than ~150 days.
For historical backfill, use Nitter scraper (`nitter_scraper.py`).

---

## Timezone Handling: Here Be Dragons

### Use calendar.timegm(), NOT datetime.timestamp() (fetch_prices.py:836)

**Wrong:**
```python
stop_at = last_ts.timestamp()  # Treats naive datetime as LOCAL time!
```

**Correct:**
```python
stop_at = calendar.timegm(last_ts.timetuple())  # Treats as UTC
```

DuckDB returns naive datetime objects. Using `.timestamp()` interprets them
as local time, which breaks incremental fetch logic.

**Fixed in:** December 2024 after workflow was re-fetching all historical data.

---

## Outlier Detection: Why 5-sigma?

### Threshold is 5σ, Not 3σ (fetch_prices.py:52, db.py:813)

```python
OUTLIER_THRESHOLD_STD = 5
```

Crypto prices have fat tails. Using 3-sigma (standard for normal distributions)
flagged legitimate 50-100% pumps as outliers. 5-sigma catches only true anomalies
like sniper bot spikes (1000x+ of median).

**DO NOT lower this threshold without testing on real pump data.**

---

## Export Pipeline: Chunking Strategy

### 1m Data is Chunked by Month (export_static.py)

Large assets can have millions of 1-minute candles. We chunk by month for:
1. Lazy loading in frontend (only load visible range)
2. Smaller individual file sizes
3. Efficient cache invalidation (only update current month)

Structure:
```
prices_1m_index.json     # Lists all chunks with date ranges
prices_1m_2025-07.json   # July 2025 data
prices_1m_2025-08.json   # August 2025 data
```

**DO NOT switch to a single prices_1m.json - it will break the frontend.**

---

## Frontend Integration

### Asset Data is Loaded Per-Asset

Frontend fetches:
1. `assets.json` (list of all assets)
2. `{asset}/tweet_events.json` (selected asset's tweets)
3. `{asset}/prices_1h.json` (for chart)
4. `{asset}/prices_1m_index.json` (for zoom, lazy loaded)

**DO NOT combine all assets into a single JSON - defeats lazy loading.**

---

## GitHub Actions Workflow

### YAML Heredoc Syntax for Inline Python (.github/workflows/hourly-update.yml)

Inline Python in YAML must use heredoc syntax:
```yaml
run: |
  python3 << 'PYTHON_SCRIPT'
  import sys
  # ... code here
  PYTHON_SCRIPT
```

**DO NOT use `python -c "..."` for multiline code** - YAML parsing breaks.

**Fixed in:** December 2024 after workflow failed with "unexpected token" errors.

---

## Checklist: Before You Commit

- [ ] Did you read this file?
- [ ] If modifying db.py views: Did you preserve staleness limits?
- [ ] If modifying export: Did you test for duplicate timestamps?
- [ ] If modifying fetch: Did you use calendar.timegm() for UTC?
- [ ] If adding timeframes: Did you add to CASE statements?
- [ ] Run `python export_static.py` - does it complete without errors?
- [ ] Open the frontend - do charts load without crashing?

---

*Last updated: December 2024*
*Maintainer: Learned these the hard way so you don't have to.*
