# Tweet-Price Correlation Analyzer

**Do founder tweets correlate with token price movements?**

A multi-asset analytics platform that visualizes and analyzes the relationship between crypto project founders' tweets and their token's price action. Track multiple projects across Solana, Hyperliquid, BSC, and Monad.

## Live Site

**https://tweet-price-rohun-voras-projects.vercel.app**

- `/chart` - Interactive candlestick chart with tweet markers
- `/data` - Tweet data table with price impact analysis

## Currently Tracking

| Token | Founder | Network | Tweets |
|-------|---------|---------|--------|
| PUMP | [@a1lon9](https://x.com/a1lon9) | Solana | 102 |
| USELESS | [@theunipcs](https://x.com/theunipcs) | Solana | 411 |
| JUP | [@weremeow](https://x.com/weremeow) | Solana | 343 |
| ASTER | [@cz_binance](https://x.com/cz_binance) | BSC | 306 |
| LAUNCHCOIN | [@pasternak](https://x.com/pasternak) | Solana | 81 |
| MONAD | [@keoneHD](https://x.com/keoneHD) | Monad | 60 |
| HYPE | [@chameleon_jeff](https://x.com/chameleon_jeff) | Hyperliquid | 34 |

## Features

### Interactive Chart
- **TradingView-style candlesticks** with multiple timeframes (1m, 15m, 1h, 1D)
- **Tweet markers** as avatar bubbles overlaid on price
- **Silence gaps** - dashed lines showing quiet periods with % price change
- **Smart clustering** - nearby tweets grouped into single markers with count badges
- **Click-to-tweet** - click any marker to open the original tweet

### Data Analysis (`/data`)
- **Sortable data table** - default sorted by 24h impact (biggest moves first)
- **Tweet Days stats** - avg return and win rate when founder tweets
- **Price impact tracking** - 1h and 24h % change after each tweet
- **Clickable tweets** - click any row to open the original tweet on X
- **Search & export** - filter tweets, export full dataset to CSV

### Multi-Asset Support
- **Asset selector** - switch between tracked projects
- **Per-asset statistics** - independent analysis for each token
- **Multi-network** - Solana, Hyperliquid, BSC, Monad

## Quick Start

### Prerequisites
- Python 3.9+
- Node.js 18+
- X API Bearer Token
- Birdeye API Key (optional, for historical backfill)

### Setup

```bash
# Clone
git clone https://github.com/rohunvora/tweet-price.git
cd tweet-price

# Python setup
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env with your API tokens
cat > .env << EOF
X_BEARER_TOKEN=your_x_api_token
BIRDEYE_API_KEY=your_birdeye_key
EOF
```

### Fetch Data

```bash
# Fetch tweets for all configured assets
python scripts/fetch_tweets.py

# Fetch price data (GeckoTerminal, Birdeye, CoinGecko, Hyperliquid)
python scripts/fetch_prices.py

# Align tweets with price candles
python scripts/align_tweets.py

# Compute statistics
python scripts/compute_stats.py

# Export static JSON for frontend
python scripts/export_static.py
```

### Run Frontend

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000

## Project Structure

```
tweet-price/
├── scripts/
│   ├── assets.json         # Asset configuration (tokens, founders, networks)
│   ├── config.py           # Global settings
│   ├── db.py               # DuckDB database management
│   ├── fetch_tweets.py     # X API tweet fetcher (incremental)
│   ├── fetch_prices.py     # Multi-source price fetcher
│   ├── align_tweets.py     # Tweet-price alignment
│   ├── compute_stats.py    # Statistical analysis
│   └── export_static.py    # JSON export for frontend
│
├── data/
│   ├── analytics.duckdb    # Main DuckDB database
│   └── {asset_id}/         # Per-asset raw data
│
├── web/                    # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── chart/      # Chart page
│   │   │   └── data/       # Data table page
│   │   ├── components/
│   │   │   ├── Chart.tsx       # TradingView-style chart
│   │   │   ├── DataTable.tsx   # Virtualized tweet table
│   │   │   ├── StatsPanel.tsx  # Statistics dashboard
│   │   │   └── AssetSelector.tsx
│   │   └── lib/
│   │       ├── dataLoader.ts   # Data fetching
│   │       ├── formatters.ts   # Display utilities
│   │       └── types.ts        # TypeScript interfaces
│   │
│   └── public/static/      # Pre-exported JSON data
│       ├── assets.json
│       └── {asset_id}/
│           ├── prices_*.json
│           ├── tweet_events.json
│           └── stats.json
│
└── vercel.json             # Deployment config
```

## How It Works

1. **Fetch tweets** from founder accounts via X API v2 (incremental with watermarks)
2. **Fetch prices** from multiple sources:
   - GeckoTerminal (DEX pools)
   - Birdeye (Solana historical backfill)
   - CoinGecko (listed tokens)
   - Hyperliquid (perp/spot)
3. **Outlier detection** - 5-sigma filtering removes sniper bot trades
4. **Align** each tweet with the price candle at that exact minute
5. **Calculate** 1h and 24h price changes after each tweet
6. **Statistical analysis** - t-tests, correlation, win rates
7. **Export** to static JSON for fast CDN delivery
8. **Visualize** on interactive chart with tweet markers

## Adding a New Asset

Edit `scripts/assets.json`:

```json
{
  "id": "token_id",
  "name": "TOKEN",
  "founder": "twitter_handle",
  "network": "solana",
  "pool_address": "dex_pool_address",
  "token_mint": "token_mint_address",
  "price_source": "geckoterminal",
  "backfill_source": "birdeye",
  "launch_date": "2025-01-01T00:00:00Z",
  "color": "#FF0000",
  "enabled": true
}
```

Then run the fetch scripts to populate data.

## Tech Stack

**Backend:** Python, DuckDB, pandas, httpx
**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4
**Charts:** lightweight-charts (TradingView)
**Tables:** TanStack React Table + React Virtual
**Deployment:** Vercel

## Disclaimer

This is for **research and educational purposes only**. Not financial advice. Correlation ≠ causation. DYOR.

---

Built to explore whether founder activity correlates with token price movements.
