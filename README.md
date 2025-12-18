# Tweet-Price Correlation Analyzer

**Visualize and analyze the correlation between crypto founder tweets and token price movements.**

An open-source tool for tracking how founder activity on X (Twitter) correlates with token price action. Built for researchers, traders, and anyone curious about the signal (or noise) in founder communication patterns.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 🎯 What This Does

This project answers a simple question: **Does it matter when a crypto founder tweets?**

- **Fetches tweets** from configured founder accounts via X API
- **Collects price data** from GeckoTerminal (DEX tokens) and CoinGecko (CEX tokens)
- **Aligns tweets with prices** to calculate exact price at tweet time and price changes after
- **Visualizes everything** in an interactive TradingView-style chart with:
  - Founder avatar bubbles at tweet locations
  - Alpha overlay showing performance vs market (SOL)
  - Silence gap indicators during quiet periods
  - Statistical analysis of tweet-day vs non-tweet-day returns

## 📊 Currently Tracking

| Token | Founder | Network | Status |
|-------|---------|---------|--------|
| PUMP | [@a1lon9](https://x.com/a1lon9) | Solana | ✅ Full data |
| JUP | [@weremeow](https://x.com/weremeow) | Solana | ✅ Full data |
| LAUNCHCOIN | [@pasternak](https://x.com/pasternak) | Solana | ✅ Full data |
| USELESS | [@theunipcs](https://x.com/theunipcs) | Solana | ✅ Full data |
| HYPE | [@chameleon_jeff](https://x.com/chameleon_jeff) | Hyperliquid | ✅ Daily data |
| PENGU | [@LucaNetz](https://x.com/LucaNetz) | Solana | ✅ Daily data |
| MONAD | [@keoneHD](https://x.com/keoneHD) | Monad | ✅ Daily data |
| ASTER | [@cz_binance](https://x.com/cz_binance) | BNB | ✅ Daily data |
| ICP | [@dominic_w](https://x.com/dominic_w) | ICP | ✅ Daily data |
| ADA | [@IOHK_Charles](https://x.com/IOHK_Charles) | Cardano | ✅ Daily data |

## 🖥️ Live Demo

The web frontend is a Next.js app that can be deployed to Vercel. Features:

- **Interactive candlestick chart** with multiple timeframes (1m, 15m, 1h, 1D)
- **Tweet markers** showing founder activity overlaid on price
- **Alpha indicator** showing token performance vs SOL (market benchmark)
- **Hover tooltips** with tweet text, engagement metrics, and price impact
- **Click to open** the original tweet on X

## 🚀 Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- X API Bearer Token (for fetching tweets)

### 1. Clone and Setup

```bash
git clone https://github.com/yourusername/tweet-price.git
cd tweet-price

# Python environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt

# Create .env file with your X API token
echo "X_BEARER_TOKEN=your_bearer_token_here" > .env
```

### 2. Fetch Data

```bash
# Fetch tweets for all assets (or use --asset pump for specific one)
python scripts/fetch_tweets.py

# Fetch price data
python scripts/fetch_prices.py

# Align tweets with prices (calculates price at tweet time + changes)
python scripts/align_tweets.py

# Export to static JSON for frontend
python scripts/export_static.py
```

### 3. Run the Web App

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
tweet-price/
├── scripts/                 # Python data pipeline
│   ├── config.py           # Asset configuration (founders, networks, colors)
│   ├── fetch_tweets.py     # X API tweet fetcher
│   ├── fetch_prices.py     # GeckoTerminal/CoinGecko price fetcher
│   ├── align_tweets.py     # Aligns tweets with price data
│   ├── export_static.py    # Exports JSON for frontend
│   ├── compute_stats.py    # Statistical analysis
│   └── cache_avatars.py    # Downloads founder avatars
│
├── data/                    # Raw data storage (gitignored)
│   └── {asset}/            # Per-asset data
│       ├── tweets.json     # Raw tweets
│       ├── prices.db       # SQLite price database
│       └── tweet_events.json  # Aligned tweet-price events
│
├── web/                     # Next.js frontend
│   ├── src/
│   │   ├── app/            # Pages (chart, data table)
│   │   ├── components/     # React components
│   │   │   ├── Chart.tsx   # Main TradingView-style chart
│   │   │   ├── DataTable.tsx
│   │   │   └── StatsPanel.tsx
│   │   └── lib/            # Utilities
│   │       ├── dataLoader.ts
│   │       ├── heatCalculator.ts  # Alpha calculations
│   │       └── types.ts
│   │
│   └── public/data/        # Static JSON served to frontend
│       ├── assets.json     # Asset index
│       └── {asset}/        # Per-asset price & tweet data
│
├── analysis/               # Python analysis scripts
│   ├── correlator.py      # Statistical correlation analysis
│   └── visualize.py       # Plotly visualizations
│
└── output/                 # Generated reports/charts
```

## 🔧 Configuration

Add new assets in `scripts/config.py`:

```python
ASSETS = {
    "pump": {
        "name": "PUMP",
        "founder": "a1lon9",           # X username
        "price_source": "geckoterminal",  # or "coingecko"
        "network": "solana",
        "pool_address": "2uF4Xh61...",  # For GeckoTerminal
        "coingecko_id": None,           # For CoinGecko
        "color": "#9945FF",
    },
    # Add more assets...
}
```

## 📈 Current Progress

### ✅ Completed

- [x] Multi-asset architecture (easily add new tokens/founders)
- [x] Tweet fetching with incremental updates (only fetches new tweets)
- [x] Price data from GeckoTerminal (1m resolution) and CoinGecko (daily)
- [x] Tweet-price alignment with 1h and 24h price change calculations
- [x] Interactive chart with lightweight-charts library
- [x] Alpha overlay (performance vs SOL market benchmark)
- [x] Smart tweet clustering (groups nearby tweets visually)
- [x] Silence gap visualization (shows quiet periods between tweets)
- [x] Hover tooltips with tweet content and engagement
- [x] Click-through to original tweets
- [x] Multiple timeframe support (1m, 15m, 1h, 1D)
- [x] Chunked 1m data loading (lazy loads by month for performance)
- [x] Static JSON export for Vercel deployment
- [x] Asset index generation for multi-asset frontend

### 🚧 In Progress

- [ ] Asset selector dropdown in frontend (backend ready)
- [ ] Stats panel showing correlation metrics
- [ ] Data table view with all aligned tweets

### 📋 Planned Features

- [ ] **Sentiment analysis** - Classify tweet sentiment and correlate with price
- [ ] **Alert system** - Notify when founder goes silent or tweets
- [ ] **Backtesting** - Simulate trading strategies based on tweet signals
- [ ] **Multi-founder comparison** - Compare tweet patterns across founders
- [ ] **Engagement correlation** - Does likes/RT count correlate with price impact?
- [ ] **Time-of-day analysis** - When do high-impact tweets happen?
- [ ] **Thread detection** - Identify tweet threads vs standalone tweets
- [ ] **Historical patterns** - Find similar past tweet-price patterns
- [ ] **API endpoint** - Serve data via REST API for external tools

## 🧮 Methodology

### Price at Tweet Time

For each tweet, we record the **candle close price** at the minute boundary. This provides a consistent, reproducible reference point.

### Alpha Calculation

Alpha measures token performance relative to the broader market (SOL):

```
alpha = token_return - market_return
```

- **Green line**: Token outperforming the market
- **Red line**: Token underperforming the market

### Statistical Significance

Correlation metrics include p-values. A p-value < 0.05 indicates statistical significance, but remember: **correlation does not imply causation**. Founders might tweet *because* price is moving, not the other way around.

## 🤝 Contributing

Contributions welcome! Some ideas:

- Add new assets to track
- Improve the frontend visualization
- Add new statistical analyses
- Build sentiment analysis pipeline
- Create alert/notification system

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## ⚠️ Disclaimer

This tool is for **research and educational purposes only**. Nothing here constitutes financial advice. Crypto markets are highly volatile and founder tweets are just one of many factors affecting price. Always do your own research.

---

Built with curiosity about markets and founder psychology 🧠📊

