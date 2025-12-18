'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadTweetEvents, loadAssets } from '@/lib/dataLoader';
import { TweetEvent, Asset } from '@/lib/types';
import DataTable from '@/components/DataTable';
import AssetSelector from '@/components/AssetSelector';

/**
 * Avatar component with fallback to colored circle
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
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-[#58A6FF] border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-[#8B949E]">Loading...</p>
      </div>
    </div>
  );
}

/**
 * Main data page content (uses useSearchParams)
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

  useEffect(() => {
    async function init() {
      console.log(`[DataPage] Initializing with asset: ${assetId}`);
      
      try {
        const loadedAssets = await loadAssets();
        setAssets(loadedAssets);
        
        // Validate asset exists
        const asset = loadedAssets.find(a => a.id === assetId);
        if (!asset) {
          throw new Error(
            `Invalid asset: "${assetId}". Valid assets: ${loadedAssets.map(a => a.id).join(', ')}`
          );
        }
        
        console.log(`[DataPage] Selected asset: ${asset.name} (${asset.id})`);
        setSelectedAsset(asset);
        
        // Load data for this asset
        const eventsData = await loadTweetEvents(assetId);
        setTweetEvents(eventsData.events);
        
        console.log(`[DataPage] Loaded ${eventsData.events.length} tweets for ${asset.name}`);
        
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[DataPage] Error: ${message}`);
        setError(message);
      }
      
      setLoading(false);
    }
    
    init();
  }, [assetId]);

  // Handle asset selection
  const handleAssetSelect = useCallback((asset: Asset) => {
    console.log(`[DataPage] Switching to asset: ${asset.id}`);
    router.push(`/data?asset=${asset.id}`);
  }, [router]);

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-[#0D1117] flex items-center justify-center p-8">
        <div className="max-w-lg w-full bg-red-900/30 border border-red-500/50 rounded-lg p-6">
          <h2 className="text-red-400 font-bold text-lg mb-2">Data Error</h2>
          <pre className="text-red-300 text-sm whitespace-pre-wrap font-mono">
            {error}
          </pre>
          <Link 
            href="/data?asset=pump"
            className="inline-block mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded transition-colors"
          >
            Go to PUMP
          </Link>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading || !selectedAsset) {
    return (
      <div className="min-h-screen bg-[#0D1117] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#58A6FF] border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-[#8B949E]">Loading {assetId}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D1117] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#30363D] bg-[#161B22]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <AssetSelector
                assets={assets}
                selectedAsset={selectedAsset}
                onSelect={handleAssetSelect}
              />
              <div>
                <h1 className="text-xl font-bold text-[#C9D1D9]">
                  ${selectedAsset.name} Tweet Analysis
                </h1>
                <p className="text-sm text-[#8B949E] mt-1">
                  Analyzing the correlation between @{selectedAsset.founder}&apos;s tweets and ${selectedAsset.name} price
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link 
                href={`/chart?asset=${selectedAsset.id}`}
                className="px-4 py-2 text-sm bg-[#21262D] text-[#8B949E] hover:bg-[#30363D] hover:text-[#C9D1D9] rounded-lg transition-colors"
              >
                View Chart
              </Link>
              <a
                href={`https://twitter.com/${selectedAsset.founder}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-[#21262D] hover:bg-[#30363D] rounded-lg transition-colors"
              >
                <FounderAvatar founder={selectedAsset.founder} color={selectedAsset.color} />
                <span className="text-[#C9D1D9]">@{selectedAsset.founder}</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Data Table */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <DataTable events={tweetEvents} />
      </main>

      {/* Footer */}
      <footer className="border-t border-[#30363D] bg-[#161B22] py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-[#6E7681]">
          <p>
            Built with data from X API & GeckoTerminal. Not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Data page wrapped in Suspense for useSearchParams
 */
export default function DataPage() {
  return (
    <Suspense fallback={<DataPageLoading />}>
      <DataPageContent />
    </Suspense>
  );
}
