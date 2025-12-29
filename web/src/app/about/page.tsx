import Link from 'next/link';
import ImpactExplorer from '@/components/ImpactExplorer';
import TweetTimeHeatmap from '@/components/TweetTimeHeatmap';
import SilencesExplorer from '@/components/SilencesExplorer';
import AssetGrid from '@/components/AssetGrid';

/**
 * About Page
 * ==========
 * Museum-like experience showing tweets and prices.
 * Show, don't tell. Let users discover patterns themselves.
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
        <span className="text-xs text-[var(--text-muted)]">tweetcharts.xyz</span>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 md:py-12 w-full">
        {/* Hero */}
        <section className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">
            What happens when founders tweet?
          </h1>
          <p className="text-lg text-[var(--text-secondary)]">
            We tracked 4,400+ tweets from 13 token founders. Here's what the data shows.
          </p>
        </section>

        {/* Module 1: Impact Explorer */}
        <section className="mb-10">
          <ImpactExplorer />
        </section>

        {/* Module 2: Time of Day */}
        <section className="mb-10">
          <TweetTimeHeatmap />
        </section>

        {/* Module 3: Silences */}
        <section className="mb-10">
          <SilencesExplorer />
        </section>

        {/* Chart Hook */}
        <section className="mb-10">
          <AssetGrid />
        </section>

        {/* Minimal data note */}
        <section className="mb-8">
          <details className="group">
            <summary className="text-sm text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
              Data sources & methodology
            </summary>
            <div className="mt-3 text-sm text-[var(--text-secondary)] space-y-2 pl-4 border-l border-[var(--border-subtle)]">
              <p>
                <strong className="text-[var(--text-primary)]">Tweets:</strong> X API + Nitter historical backfill
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">Prices:</strong> GeckoTerminal, Birdeye, CoinGecko, Hyperliquid
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">Updates:</strong> Hourly via GitHub Actions
              </p>
              <p className="text-[var(--text-muted)] italic">
                Correlation ≠ causation. This is a visualization tool, not financial advice.
              </p>
            </div>
          </details>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
        <a
          href="https://github.com/anthropics/tweet-price"
          className="hover:text-[var(--text-secondary)] transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          View source on GitHub
        </a>
      </footer>
    </div>
  );
}
