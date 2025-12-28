import Link from 'next/link';

/**
 * About Page
 * ==========
 * Explains the purpose of the site so visitors from a shared link
 * understand what they're looking at.
 */
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-0)] flex flex-col">
      {/* Header */}
      <header className="h-14 md:h-11 border-b border-[var(--border-subtle)] bg-[var(--surface-1)] flex items-center px-4 gap-3">
        <Link
          href="/chart"
          className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md transition-colors"
        >
          ← Chart
        </Link>
        <div className="flex-1" />
        <Link
          href="/data"
          className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md transition-colors"
        >
          Data
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-2xl mx-auto px-4 py-8 md:py-12">
        {/* Hero */}
        <h1 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] mb-3">
          Do founder tweets move token prices?
        </h1>
        <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
          This site visualizes the relationship between crypto project founders&apos; tweets and their token&apos;s price action.
          Select an asset to see every tweet overlaid on price, sorted by impact.
        </p>

        {/* How to Read the Chart */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            How to Read the Chart
          </h2>
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-lg p-4 space-y-3">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[var(--accent)] flex-shrink-0" />
              <div>
                <span className="text-[var(--text-primary)] font-medium">Avatar bubbles</span>
                <span className="text-[var(--text-secondary)]"> — Each bubble is a tweet at that price and time. Click to open the original tweet.</span>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[var(--surface-3)] flex-shrink-0 flex items-center justify-center text-[var(--text-muted)] text-xs font-bold">3</div>
              <div>
                <span className="text-[var(--text-primary)] font-medium">Clustered bubbles</span>
                <span className="text-[var(--text-secondary)]"> — When tweets happen close together, they&apos;re grouped with a count badge.</span>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 flex-shrink-0 flex items-center">
                <div className="w-full border-t-2 border-dashed border-[var(--text-muted)]" />
              </div>
              <div>
                <span className="text-[var(--text-primary)] font-medium">Silence gaps</span>
                <span className="text-[var(--text-secondary)]"> — Dashed lines show periods of no tweets, with the % price change during silence.</span>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                <span className="text-[var(--positive)] font-bold">↑</span>
              </div>
              <div>
                <span className="text-[var(--text-primary)] font-medium">Impact colors</span>
                <span className="text-[var(--text-secondary)]"> — </span>
                <span className="text-[var(--positive)]">Green</span>
                <span className="text-[var(--text-secondary)]"> = price went up after tweet. </span>
                <span className="text-[var(--negative)]">Red</span>
                <span className="text-[var(--text-secondary)]"> = price went down.</span>
              </div>
            </div>
          </div>
        </section>

        {/* Data & Methodology */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Data &amp; Methodology
          </h2>
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-lg p-4 space-y-2 text-[var(--text-secondary)]">
            <p>
              <span className="text-[var(--text-primary)]">Tweets:</span> Fetched from X API (recent) and Nitter (historical backfill).
            </p>
            <p>
              <span className="text-[var(--text-primary)]">Prices:</span> GeckoTerminal, Birdeye, CoinGecko, and Hyperliquid depending on where the token trades.
            </p>
            <p>
              <span className="text-[var(--text-primary)]">Outlier filtering:</span> 5-sigma threshold removes obvious bot trades and price glitches.
            </p>
            <p>
              <span className="text-[var(--text-primary)]">Price impact:</span> The % change 1 hour and 24 hours after each tweet.
            </p>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Disclaimer
          </h2>
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-lg p-4 text-[var(--text-secondary)] space-y-2">
            <p>
              This is for <span className="text-[var(--text-primary)]">research and educational purposes only</span>. Not financial advice.
            </p>
            <p>
              <span className="text-[var(--text-primary)]">Correlation ≠ causation.</span> A tweet before a price move doesn&apos;t mean the tweet caused the move.
            </p>
            <p>
              Do your own research. Past performance is not indicative of future results.
            </p>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center">
          <Link
            href="/chart"
            className="inline-block px-6 py-3 bg-[var(--accent)] text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            View the Chart →
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
        Built to explore whether founder activity correlates with token price movements.
      </footer>
    </div>
  );
}
