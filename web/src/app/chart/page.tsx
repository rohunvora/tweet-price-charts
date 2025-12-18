'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { loadTweetEvents, loadAssets } from '@/lib/dataLoader';
import { TweetEvent, Asset } from '@/lib/types';
import AssetSelector from '@/components/AssetSelector';

const Chart = dynamic(() => import('@/components/Chart'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#131722]">
      <div className="text-[#787B86]">Loading chart...</div>
    </div>
  ),
});

/**
 * Avatar component with fallback to colored circle
 */
function FounderAvatar({ founder, color }: { founder: string; color: string }) {
  const [imgError, setImgError] = useState(false);
  
  if (imgError) {
    console.warn(`[ChartPage] Missing avatar for ${founder}`);
    return (
      <div 
        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
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
      className="w-5 h-5 rounded-full"
      onError={() => setImgError(true)}
    />
  );
}

/**
 * Loading fallback for Suspense
 */
function ChartPageLoading() {
  return (
    <div className="h-screen bg-[#131722] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-[#2962FF] border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-[#787B86]">Loading...</p>
      </div>
    </div>
  );
}

/**
 * Main chart page content (uses useSearchParams)
 */
function ChartPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [tweetEvents, setTweetEvents] = useState<TweetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get asset ID from URL, default to 'pump'
  const assetId = searchParams.get('asset') || 'pump';

  // Load assets on mount
  useEffect(() => {
    async function init() {
      console.log(`[ChartPage] Initializing with asset: ${assetId}`);
      
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
        
        console.log(`[ChartPage] Selected asset: ${asset.name} (${asset.id})`);
        setSelectedAsset(asset);
        
        // Load tweet events for this asset
        const eventsData = await loadTweetEvents(assetId);
        setTweetEvents(eventsData.events);
        
        console.log(`[ChartPage] Loaded ${eventsData.events.length} tweets for ${asset.name}`);
        
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ChartPage] Error: ${message}`);
        setError(message);
      }
      
      setLoading(false);
    }
    
    init();
  }, [assetId]);

  // Handle asset selection
  const handleAssetSelect = useCallback((asset: Asset) => {
    console.log(`[ChartPage] Switching to asset: ${asset.id}`);
    router.push(`/chart?asset=${asset.id}`);
  }, [router]);

  // Error state
  if (error) {
    return (
      <div className="h-screen bg-[#131722] flex items-center justify-center p-8">
        <div className="max-w-lg w-full bg-red-900/30 border border-red-500/50 rounded-lg p-6">
          <h2 className="text-red-400 font-bold text-lg mb-2">Data Error</h2>
          <pre className="text-red-300 text-sm whitespace-pre-wrap font-mono">
            {error}
          </pre>
          <Link 
            href="/chart?asset=pump"
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
      <div className="h-screen bg-[#131722] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#2962FF] border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-[#787B86]">Loading {assetId}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#131722] flex flex-col">
      {/* Top toolbar - TradingView style */}
      <div className="h-10 bg-[#1E222D] border-b border-[#2A2E39] flex items-center px-2 gap-2">
        {/* Asset selector */}
        <AssetSelector 
          assets={assets}
          selectedAsset={selectedAsset}
          onSelect={handleAssetSelect}
        />
        
        {/* Network badge */}
        <span className="text-[#787B86] text-xs">/USD</span>
        
        {/* Navigation */}
        <div className="flex items-center gap-1 ml-auto">
          <Link 
            href={`/chart?asset=${selectedAsset.id}`}
            className="px-3 py-1 text-xs bg-[#2962FF] text-white rounded"
          >
            Chart
          </Link>
          <Link 
            href={`/data?asset=${selectedAsset.id}`}
            className="px-3 py-1 text-xs bg-[#2A2E39] text-[#787B86] hover:text-[#D1D4DC] rounded"
          >
            Data Table
          </Link>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 relative">
        <Chart tweetEvents={tweetEvents} asset={selectedAsset} />
      </div>

      {/* Bottom bar */}
      <div className="h-8 bg-[#1E222D] border-t border-[#2A2E39] flex items-center px-4 justify-between">
        <div className="flex items-center gap-4">
          <a
            href={`https://twitter.com/${selectedAsset.founder}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[#787B86] hover:text-[#D1D4DC] text-xs"
          >
            <FounderAvatar founder={selectedAsset.founder} color={selectedAsset.color} />
            <span>@{selectedAsset.founder} tweets shown</span>
          </a>
        </div>
        <div className="text-[#787B86] text-xs">
          {tweetEvents.length} tweets • Data from X API & GeckoTerminal
        </div>
      </div>
    </div>
  );
}

/**
 * Chart page wrapped in Suspense for useSearchParams
 */
export default function ChartPage() {
  return (
    <Suspense fallback={<ChartPageLoading />}>
      <ChartPageContent />
    </Suspense>
  );
}
