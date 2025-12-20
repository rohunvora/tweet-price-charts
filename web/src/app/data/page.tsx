'use client';

/**
 * Data Page - Tweet Analysis Dashboard
 * =====================================
 * Displays comprehensive tweet analysis data for a selected asset.
 *
 * Layout:
 * - Header: Asset selector + days since last tweet + navigation
 * - Top Movers: Best performing and worst performing tweets
 * - Data Table: Full tweet list with sorting and filtering
 *
 * Features:
 * - URL-based asset selection (?asset=pump)
 * - "Days since last tweet" live indicator
 * - Top 3 pumps and dumps highlighted
 * - Sortable, searchable data table
 * - CSV export
 *
 * @module app/data/page
 */

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadTweetEvents, loadAssets } from '@/lib/dataLoader';
import { TweetEvent, Asset } from '@/lib/types';
import DataTable from '@/components/DataTable';
import AssetSelector from '@/components/AssetSelector';
import TopMovers from '@/components/TopMovers';

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

/**
 * Avatar component with fallback to colored circle
 * Used in header for founder identification
 */
function FounderAvatar({ founder, color }: { founder: string; color: string }) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    console.warn(`[DataPage] Missing avatar for ${founder}`);
    return (
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
        style={{ backgroundColor: color }}
      >
        {founder.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={`/avatars/${founder}.png`}
      alt={founder}
      className="w-6 h-6 rounded-full"
      onError={() => setImgError(true)}
    />
  );
}

/**
 * Loading fallback for Suspense
 */
function DataPageLoading() {
  return (
    <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-[var(--text-muted)]">Loading...</p>
      </div>
    </div>
  );
}

// ============================================================================
// DAYS SINCE TWEET COMPONENT
// ============================================================================

/**
 * DaysSinceTweet - Live indicator showing time since last tweet
 *
 * Display logic:
 * - 0 days: "Today" in green
 * - 1-3 days: Yellow warning
 * - 4+ days: Red alert
 *
 * Helps users quickly gauge founder activity level
 */
function DaysSinceTweet({ events }: { events: TweetEvent[] }) {
  // Find most recent tweet timestamp
  const lastTweetTime = useMemo(() => {
    if (events.length === 0) return null;
    return Math.max(...events.map((e) => e.timestamp));
  }, [events]);

  // Calculate days since last tweet
  const daysSince = useMemo(() => {
    if (!lastTweetTime) return null;
    const now = Date.now() / 1000;
    const diff = now - lastTweetTime;
    return Math.floor(diff / 86400); // 86400 seconds per day
  }, [lastTweetTime]);

  if (daysSince === null || lastTweetTime === null) return null;

  // Color coding based on recency
  let colorClass = 'text-[var(--positive)]';
  let bgClass = 'bg-[var(--positive)]/10';
  let label = 'Today';

  if (daysSince === 1) {
    colorClass = 'text-[var(--positive)]';
    bgClass = 'bg-[var(--positive)]/10';
    label = '1 day ago';
  } else if (daysSince > 1 && daysSince <= 3) {
    colorClass = 'text-yellow-500';
    bgClass = 'bg-yellow-500/10';
    label = `${daysSince} days ago`;
  } else if (daysSince > 3) {
    colorClass = 'text-[var(--negative)]';
    bgClass = 'bg-[var(--negative)]/10';
    label = `${daysSince} days ago`;
  }

  // Format the last tweet date for tooltip
  const lastTweetDate = new Date(lastTweetTime * 1000).toLocaleString();

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${bgClass}`}
      title={`Last tweet: ${lastTweetDate}`}
    >
      {/* Pulsing dot for recent tweets */}
      {daysSince <= 1 && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--positive)] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--positive)]"></span>
        </span>
      )}
      <span className={`text-sm font-medium ${colorClass}`}>
        {label}
      </span>
    </div>
  );
}

// ============================================================================
// MAIN DATA PAGE CONTENT
// ============================================================================

/**
 * DataPageContent - Main page content (uses useSearchParams)
 *
 * State management:
 * - assets: All available assets from assets.json
 * - selectedAsset: Currently selected asset
 * - tweetEvents: Tweet data for selected asset
 * - loading/error: UI states
 *
 * URL handling:
 * - Reads ?asset= from URL (defaults to 'pump')
 * - Updates URL when user selects different asset
 */
function DataPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [tweetEvents, setTweetEvents] = useState<TweetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get asset ID from URL, default to 'pump'
  const assetId = searchParams.get('asset') || 'pump';

  // Load data on mount and asset change
  useEffect(() => {
    async function init() {
      console.log(`[DataPage] Initializing with asset: ${assetId}`);

      try {
        const loadedAssets = await loadAssets();
        setAssets(loadedAssets);

        // Validate asset exists
        const asset = loadedAssets.find((a) => a.id === assetId);
        if (!asset) {
          throw new Error(
            `Invalid asset: "${assetId}". Valid assets: ${loadedAssets.map((a) => a.id).join(', ')}`
          );
        }

        console.log(`[DataPage] Selected asset: ${asset.name} (${asset.id})`);
        setSelectedAsset(asset);

        // Load data for this asset
        const eventsData = await loadTweetEvents(assetId);
        setTweetEvents(eventsData.events);

        console.log(
          `[DataPage] Loaded ${eventsData.events.length} tweets for ${asset.name}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[DataPage] Error: ${message}`);
        setError(message);
      }

      setLoading(false);
    }

    init();
  }, [assetId]);

  // Handle asset selection (update URL)
  const handleAssetSelect = useCallback(
    (asset: Asset) => {
      console.log(`[DataPage] Switching to asset: ${asset.id}`);
      router.push(`/data?asset=${asset.id}`);
    },
    [router]
  );

  // ============================================================================
  // RENDER: ERROR STATE
  // ============================================================================

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center p-8">
        <div className="max-w-lg w-full bg-[var(--negative-muted)]/30 border border-[var(--negative)]/50 rounded-xl p-6">
          <h2 className="text-[var(--negative)] font-bold text-lg mb-2">
            Data Error
          </h2>
          <pre className="text-[var(--negative)]/80 text-sm whitespace-pre-wrap font-mono">
            {error}
          </pre>
          <Link
            href="/data?asset=pump"
            className="inline-block mt-4 px-4 py-2 bg-[var(--negative)]/20 hover:bg-[var(--negative)]/30 text-[var(--negative)] rounded-lg transition-colors interactive"
          >
            Go to PUMP
          </Link>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: LOADING STATE
  // ============================================================================

  if (loading || !selectedAsset) {
    return (
      <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-[var(--text-muted)]">Loading {assetId}...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: MAIN CONTENT
  // ============================================================================

  return (
    <div className="min-h-screen bg-[var(--surface-0)] flex flex-col">
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}
      <header className="border-b border-[var(--border-subtle)] bg-[var(--surface-1)]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Left side: Asset selector + title */}
            <div className="flex items-center gap-4">
              <AssetSelector
                assets={assets}
                selectedAsset={selectedAsset}
                onSelect={handleAssetSelect}
              />
              <div className="hidden md:block">
                <h1 className="text-xl font-bold text-[var(--text-primary)]">
                  ${selectedAsset.name} Tweet Analysis
                </h1>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                  Analyzing @{selectedAsset.founder}&apos;s tweets
                </p>
              </div>
            </div>

            {/* Right side: Days since tweet + navigation (desktop) */}
            <div className="hidden md:flex items-center gap-3">
              {/* Days since last tweet indicator */}
              <DaysSinceTweet events={tweetEvents} />

              {/* View Chart button */}
              <Link
                href={`/chart?asset=${selectedAsset.id}`}
                className="px-4 py-2 text-sm font-medium bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] rounded-lg transition-colors interactive"
              >
                View Chart
              </Link>

              {/* Founder Twitter link */}
              <a
                href={`https://twitter.com/${selectedAsset.founder}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg transition-colors interactive"
              >
                <FounderAvatar
                  founder={selectedAsset.founder}
                  color={selectedAsset.color}
                />
                <span className="text-[var(--text-primary)] text-sm font-medium">
                  @{selectedAsset.founder}
                </span>
              </a>
            </div>

            {/* Mobile: Chart link + days since */}
            <div className="md:hidden flex items-center justify-between">
              <Link
                href={`/chart?asset=${selectedAsset.id}`}
                className="text-sm text-[var(--accent)] font-medium"
              >
                ← Back to Chart
              </Link>
              <DaysSinceTweet events={tweetEvents} />
            </div>
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* MAIN CONTENT */}
      {/* ================================================================== */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4 md:py-6 space-y-6">
        {/* Top Movers Section */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Notable Tweets
          </h2>
          <TopMovers events={tweetEvents} founder={selectedAsset.founder} />
        </section>

        {/* Data Table Section */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            All Tweets
          </h2>
          <DataTable
            events={tweetEvents}
            founder={selectedAsset.founder}
            assetName={selectedAsset.name}
          />
        </section>
      </main>

      {/* ================================================================== */}
      {/* FOOTER */}
      {/* ================================================================== */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--surface-1)] py-4 pb-safe">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-[var(--text-muted)]">
          <p>Built with data from X API & GeckoTerminal. Not financial advice.</p>
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// DATA PAGE (WRAPPED IN SUSPENSE)
// ============================================================================

/**
 * DataPage - Entry point wrapped in Suspense
 * Required for useSearchParams() in Next.js App Router
 */
export default function DataPage() {
  return (
    <Suspense fallback={<DataPageLoading />}>
      <DataPageContent />
    </Suspense>
  );
}
