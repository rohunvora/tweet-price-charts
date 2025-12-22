# Feature Branch: outlier-filter

## Status: Working Prototype (USELESS only)

## What's Done
- ✅ Added outlier fields to TweetEvent type (`is_outlier`, `outlier_type`, `impact_percentile`)
- ✅ Computed outliers for USELESS (45 of 420 tweets = 10.7%)
- ✅ Added "⚡ Outliers (45)" toggle button in Chart.tsx
- ✅ Button filters displayed tweets to only show outliers
- ✅ Amber highlight when filter is active

## What's NOT Done
- ❌ Compute outliers for other high-volume assets (PUMP, HYPE, FARTCOIN, etc.)
- ❌ Add outlier computation to automated export pipeline (export_static.py)
- ❌ Visual distinction for outlier bubbles (gold ring? different glow?)
- ❌ Filter in Data Table view
- ❌ Mobile toggle button
- ❌ Sort by impact_percentile

## Key Files Changed
- `web/src/lib/types.ts` - Added outlier fields to TweetEvent
- `web/src/components/Chart.tsx` - Added toggle button and filtering logic
- `web/public/static/useless/tweet_events.json` - Has outlier data

## How Outliers Are Computed
```python
mean = average of all change_24h_pct
std = standard deviation
threshold = 1.5 * std
is_outlier = abs(change_24h_pct - mean) > threshold
```

## To Test
1. `npm run dev` in web/
2. Go to http://localhost:3000/chart?asset=useless
3. Click "⚡ Outliers (45)" button
4. Chart should show only 45 high-impact tweets instead of 420

