# Changelog - Tweet-Price Correlation Analyzer

## Dec 28, 2025 - ZEC Asset & Workflow Fixes
- Add ZEC asset (adopter: mert)
- Fix workflow failures - validate cache vs release, use CoinGecko Pro API
- Add missing `get_latest_price_timestamp` function to db.py

## Dec 23, 2025 - Market Cap Tracking & Data Enhancements
- Backfill WIF tweets from Dec 2023 (30 new early tweets)
- Add market cap column to Data Table with historical backfill
- Add `supply_unstable` flag for assets like JUP/WLD
- Redesign Data Table with price context and full tweet text
- Add "First Tweet" navigation button

## Dec 21-22, 2025 - Asset Expansion Phase
- **New assets:** FARTCOIN (DipWheeler), WLD (Sam Altman), XPL (Plasma), WIF
- Add `--keyword-search` mode to nitter_scraper.py
- Hybrid arrow/bubble markers based on zoom level
- Bi-directional tweet navigation system
- Replace ClusterDrawer with TweetImpactCard
- Unified tweet filtering for founders and adopters
- Comprehensive data quality validation tools

## Dec 20, 2025 - ZORA Launch & Mobile Overhaul
- **New asset:** ZORA (@js_horne)
- Complete price history recovery from Birdeye
- Post-export validation with auto-fix capability
- Mobile UI Phase 1 & 2: bottom tab navigation, viewport fixes
- Data overrides system for persistent fixes
- Chart resize loop prevention

## Dec 19-20, 2025 - Premium Visual Redesign
- Premium CSS reskin with Inter font and design tokens
- Impact-encoded tweet markers (green=pump, red=dump)
- Direction-aware silence line labels
- Data Table redesign with primitive table philosophy
- TopMovers component and days-since-tweet indicator
- Admin UI for adding new assets
- Automatic fake wick capping at export time

## Dec 19, 2025 - Data Pipeline & Chart Engine
- Proper incremental price fetching
- Hourly data update workflow (GitHub Actions)
- Complete chart engine overhaul for accurate markers
- DST timestamp deduplication
- GOTCHAS.md documentation to prevent regressions
- Comprehensive Chart.tsx comments

## Dec 18-19, 2025 - Historical Data Recovery
- ASTER/CZ tweets backfill (Sept 17-20)
- JUP backfill: 321 tweets (Jan 2024 - Mar 2025)
- Fix duplicate timestamps in JUP and BELIEVE
- All data consolidated into DuckDB

## Dec 17-18, 2025 - Multi-Asset Foundation
- Multi-asset support added to frontend
- Cluster zoom with micro-delights
- Adaptive tweet heat visualization
- TradingView-style interface with separate pages
- Token logos and proper ticker names
- Timeframe-adaptive tweet markers

## Dec 17, 2025 - Project Genesis
- Initial commit with TradingView-style chart
- Core chart implementation with lightweight-charts v4
- Basic tweet-price correlation visualization

---

## Assets (13 total)

ASTER, BELIEVE, FARTCOIN, HYPE, JUP, META, MONAD, USELESS, WIF, WLD, XPL, ZEC, ZORA

## Key Infrastructure

- **Data sources:** X API, CoinGecko, GeckoTerminal, Birdeye, Nitter
- **Pipeline:** fetch → DuckDB → export_static → JSON → Frontend
- **Deployment:** Vercel with hourly automated updates
- **Quality:** 5-sigma outlier detection, validation safeguards, data overrides system
