import Link from 'next/link';
import ImpactExplorer from '@/components/ImpactExplorer';

/**
 * About Page
 * ==========
 * Interactive explainer page inspired by loggingsucks.com
 * Shows the data first, explains second.
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
      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 md:py-12 w-full">
        {/* Hero - Show, don't tell */}
        <section className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">
            Founder tweets. Price moves.
          </h1>
          <p className="text-lg text-[var(--text-secondary)] mb-6">
            Or do they? Explore the data yourself.
          </p>

          {/* Impact Explorer - THE INTERACTIVE ELEMENT */}
          <ImpactExplorer />
        </section>

        {/* How to Read Section */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">
            What you&apos;re looking at
          </h2>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Each dot */}
            <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex gap-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--positive)]" />
                  <div className="w-3 h-3 rounded-full bg-[var(--negative)]" />
                </div>
                <span className="text-[var(--text-primary)] font-medium">Each dot = one tweet</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                <span className="text-[var(--positive)]">Green</span> means price went up after the tweet.
                <span className="text-[var(--negative)]"> Red</span> means it went down.
                The further from center, the bigger the move.
              </p>
            </div>

            {/* Time axis */}
            <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="text-[var(--text-muted)]">←  →</div>
                <span className="text-[var(--text-primary)] font-medium">Time flows left to right</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Older tweets on the left, recent on the right.
                Filter by time range to focus on specific periods.
              </p>
            </div>

            {/* Hover */}
            <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="text-lg">👆</div>
                <span className="text-[var(--text-primary)] font-medium">Hover for details</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                See the actual tweet text, which asset, and precise % impact.
                Click any dot to open the original tweet on X.
              </p>
            </div>

            {/* Stats */}
            <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="text-lg tabular-nums font-bold text-[var(--text-primary)]">%</div>
                <span className="text-[var(--text-primary)] font-medium">Summary stats below</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Total tweets, % that were followed by positive price action,
                and average impact across the dataset.
              </p>
            </div>
          </div>
        </section>

        {/* The Caveat - Interactive would be even better */}
        <section className="mb-12">
          <div className="bg-gradient-to-r from-[var(--negative-muted)] to-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-6">
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
              The caveat you should know
            </h2>

            <div className="space-y-4 text-[var(--text-secondary)]">
              <p>
                <span className="text-[var(--text-primary)] font-medium">Correlation ≠ causation.</span>{' '}
                A green dot doesn&apos;t mean the tweet <em>caused</em> the pump.
                Maybe the whole market was up. Maybe insiders knew before the tweet.
              </p>

              <p>
                <span className="text-[var(--text-primary)] font-medium">Survivorship bias.</span>{' '}
                We track projects with active founders. The dead projects with silent founders aren&apos;t here.
              </p>

              <p>
                <span className="text-[var(--text-primary)] font-medium">This is not financial advice.</span>{' '}
                It&apos;s a research tool. Don&apos;t ape based on vibes and dots.
              </p>
            </div>
          </div>
        </section>

        {/* Data Sources - Collapsed by default would be nice */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">
            Where the data comes from
          </h2>

          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl divide-y divide-[var(--border-subtle)]">
            <div className="p-4 flex justify-between items-center">
              <span className="text-[var(--text-primary)] font-medium">Tweets</span>
              <span className="text-[var(--text-secondary)] text-sm">X API + Nitter historical backfill</span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[var(--text-primary)] font-medium">Prices</span>
              <span className="text-[var(--text-secondary)] text-sm">GeckoTerminal, Birdeye, CoinGecko, Hyperliquid</span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[var(--text-primary)] font-medium">Impact calculation</span>
              <span className="text-[var(--text-secondary)] text-sm">% change 1h and 24h after tweet</span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[var(--text-primary)] font-medium">Outlier removal</span>
              <span className="text-[var(--text-secondary)] text-sm">5-sigma threshold for price glitches</span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[var(--text-primary)] font-medium">Update frequency</span>
              <span className="text-[var(--text-secondary)] text-sm">Hourly via GitHub Actions</span>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center mb-8">
          <p className="text-[var(--text-secondary)] mb-4">
            Ready to explore individual assets with full price charts?
          </p>
          <Link
            href="/chart"
            className="inline-block px-8 py-4 bg-[var(--accent)] text-white font-semibold rounded-xl hover:opacity-90 transition-opacity text-lg"
          >
            Open the Chart →
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
        <p className="mb-1">Built to explore whether founder activity correlates with token price movements.</p>
        <p>
          <a
            href="https://github.com/anthropics/tweet-price"
            className="hover:text-[var(--text-secondary)] transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source on GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
