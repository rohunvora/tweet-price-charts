import { PriceData, Timeframe, Candle, TweetEvent, TweetEventsData, Asset, Stats } from './types';

// =============================================================================
// Debug Logging
// =============================================================================

const DEBUG = true;

function log(msg: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.log(`[dataLoader] ${msg}`, data);
    } else {
      console.log(`[dataLoader] ${msg}`);
    }
  }
}

// =============================================================================
// Cache
// =============================================================================

const priceCache = new Map<string, PriceData>();
const tweetCache = new Map<string, TweetEventsData>();
let assetsCache: Asset[] | null = null;

// =============================================================================
// Asset Loading
// =============================================================================

/**
 * Load all enabled assets from assets.json
 */
export async function loadAssets(): Promise<Asset[]> {
  if (assetsCache) {
    log('Using cached assets');
    return assetsCache;
  }

  log('Loading assets.json');
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:entry',message:'Starting loadAssets',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  const response = await fetch('/data/assets.json');
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:response',message:'Fetch response',data:{ok:response.ok,status:response.status,statusText:response.statusText},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  if (!response.ok) {
    throw new Error(`Failed to load assets.json: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:parsed',message:'Parsed JSON',data:{hasAssets:!!data.assets,assetsLength:data.assets?.length,allAssets:data.assets?.map((a:Asset)=>({id:a.id,enabled:a.enabled}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3,H5'})}).catch(()=>{});
  // #endregion
  
  const enabledAssets = data.assets.filter((a: Asset) => a.enabled);
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:filtered',message:'Filtered assets',data:{enabledCount:enabledAssets.length,enabledIds:enabledAssets.map((a:Asset)=>a.id)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  
  log(`Loaded ${enabledAssets.length} enabled assets`, enabledAssets.map((a: Asset) => a.id));
  
  assetsCache = enabledAssets;
  return enabledAssets;
}

// =============================================================================
// Price Loading
// =============================================================================

/**
 * Load price data for a specific asset and timeframe
 */
export async function loadPrices(timeframe: Timeframe, assetId: string): Promise<PriceData> {
  const cacheKey = `${assetId}:${timeframe}`;
  
  if (priceCache.has(cacheKey)) {
    log(`Using cached prices for ${assetId} @ ${timeframe}`);
    return priceCache.get(cacheKey)!;
  }
  
  log(`Loading prices for ${assetId} @ ${timeframe}`);
  
  // For 1m, we need to load the index and potentially multiple chunks
  if (timeframe === '1m') {
    return load1mPrices(assetId);
  }
  
  const path = `/data/${assetId}/prices_${timeframe}.json`;
  const response = await fetch(path);
  
  if (!response.ok) {
    throw new Error(`Missing price data: ${path} (${response.status} ${response.statusText})`);
  }
  
  const data: PriceData = await response.json();
  
  log(`Loaded ${data.count} candles for ${assetId} @ ${timeframe}`);
  
  priceCache.set(cacheKey, data);
  return data;
}

/**
 * Load 1m prices (chunked by month for performance)
 */
async function load1mPrices(assetId: string): Promise<PriceData> {
  const cacheKey = `${assetId}:1m`;
  
  if (priceCache.has(cacheKey)) {
    log(`Using cached 1m prices for ${assetId}`);
    return priceCache.get(cacheKey)!;
  }
  
  // Load index
  const indexPath = `/data/${assetId}/prices_1m_index.json`;
  log(`Loading 1m index from ${indexPath}`);
  
  const indexResponse = await fetch(indexPath);
  
  if (!indexResponse.ok) {
    throw new Error(`Missing 1m price index: ${indexPath} (${indexResponse.status} ${indexResponse.statusText})`);
  }
  
  const index = await indexResponse.json();
  
  log(`Found ${index.chunks.length} chunks for ${assetId} 1m data`);
  
  // Load all chunks in parallel
  const chunkPromises = index.chunks.map(async (chunk: { file: string }) => {
    const chunkPath = `/data/${assetId}/${chunk.file}`;
    log(`Loading chunk: ${chunkPath}`);
    
    const response = await fetch(chunkPath);
    
    if (!response.ok) {
      throw new Error(`Missing price chunk: ${chunkPath} (${response.status} ${response.statusText})`);
    }
    
    return response.json();
  });
  
  const chunks = await Promise.all(chunkPromises);
  
  // Merge all candles
  const allCandles: Candle[] = [];
  for (const chunk of chunks) {
    allCandles.push(...chunk.candles);
  }
  
  // Sort by timestamp
  allCandles.sort((a, b) => a.t - b.t);
  
  const merged: PriceData = {
    timeframe: '1m',
    count: allCandles.length,
    start: allCandles[0]?.t || 0,
    end: allCandles[allCandles.length - 1]?.t || 0,
    candles: allCandles,
  };
  
  log(`Loaded ${merged.count} total 1m candles for ${assetId}`);
  
  priceCache.set(cacheKey, merged);
  return merged;
}

// =============================================================================
// Tweet Loading
// =============================================================================

/**
 * Load tweet events data for a specific asset
 */
export async function loadTweetEvents(assetId: string): Promise<TweetEventsData> {
  const cacheKey = assetId;
  
  if (tweetCache.has(cacheKey)) {
    log(`Using cached tweet events for ${assetId}`);
    return tweetCache.get(cacheKey)!;
  }
  
  log(`Loading tweet events for ${assetId}`);
  
  const path = `/data/${assetId}/tweet_events.json`;
  const response = await fetch(path);
  
  if (!response.ok) {
    throw new Error(`Missing tweet events: ${path} (${response.status} ${response.statusText})`);
  }
  
  const data: TweetEventsData = await response.json();
  
  log(`Loaded ${data.count} tweet events for ${assetId}`);
  
  tweetCache.set(cacheKey, data);
  return data;
}

// =============================================================================
// Stats Loading
// =============================================================================

/**
 * Load pre-computed statistics for a specific asset
 */
export async function loadStats(assetId: string): Promise<Stats> {
  log(`Loading stats for ${assetId}`);
  
  const path = `/data/${assetId}/stats.json`;
  const response = await fetch(path);
  
  if (!response.ok) {
    throw new Error(`Missing stats: ${path} (${response.status} ${response.statusText})`);
  }
  
  const data: Stats = await response.json();
  
  log(`Loaded stats for ${assetId}`);
  
  return data;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert price data to Lightweight Charts candlestick format
 */
export function toCandlestickData(prices: PriceData) {
  return prices.candles.map(c => ({
    time: c.t as number,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
  }));
}

/**
 * Get sorted array of tweet timestamps for binary search
 */
export function getSortedTweetTimestamps(tweets: TweetEvent[]): number[] {
  return tweets
    .filter(t => t.price_at_tweet !== null)
    .map(t => t.timestamp)
    .sort((a, b) => a - b);
}

/**
 * Clear all caches (useful for testing/debugging)
 */
export function clearCaches() {
  log('Clearing all caches');
  priceCache.clear();
  tweetCache.clear();
  assetsCache = null;
}
