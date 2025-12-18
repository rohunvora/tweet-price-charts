import { PriceData, Timeframe, Candle, TweetEvent, TweetEventsData, Asset, Stats } from './types';

// =============================================================================
// Debug Logging
// =============================================================================

const DEBUG = false;

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
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:entry',message:'Fetching /static/assets.json',data:{url:'/static/assets.json'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  const response = await fetch('/static/assets.json');

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:response',message:'assets.json response',data:{status:response.status,ok:response.ok,statusText:response.statusText,contentType:response.headers.get('content-type')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  if (!response.ok) {
    throw new Error(`Failed to load assets.json: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const enabledAssets = data.assets.filter((a: Asset) => a.enabled);

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadAssets:success',message:'Assets loaded successfully',data:{count:enabledAssets.length,ids:enabledAssets.map((a:Asset)=>a.id)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
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
  
  const path = `/static/${assetId}/prices_${timeframe}.json`;

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadPrices:entry',message:'Fetching prices',data:{assetId,timeframe,path},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  const response = await fetch(path);

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadPrices:response',message:'prices response',data:{assetId,timeframe,path,status:response.status,ok:response.ok,contentType:response.headers.get('content-type')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  if (!response.ok) {
    // Graceful fallback for missing timeframe data (e.g., CoinGecko assets only have 1d)
    console.warn(`[dataLoader] Missing price data: ${path} (${response.status})`);
    return {
      timeframe,
      count: 0,
      start: 0,
      end: 0,
      candles: [],
    };
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
  const indexPath = `/static/${assetId}/prices_1m_index.json`;
  log(`Loading 1m index from ${indexPath}`);
  
  const indexResponse = await fetch(indexPath);
  
  if (!indexResponse.ok) {
    // Graceful fallback for assets without 1m data
    console.warn(`[dataLoader] Missing 1m price index: ${indexPath} (${indexResponse.status})`);
    return {
      timeframe: '1m',
      count: 0,
      start: 0,
      end: 0,
      candles: [],
    };
  }
  
  const index = await indexResponse.json();
  
  log(`Found ${index.chunks.length} chunks for ${assetId} 1m data`);
  
  // Load all chunks in parallel
  const chunkPromises = index.chunks.map(async (chunk: { file: string }) => {
    const chunkPath = `/static/${assetId}/${chunk.file}`;
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
  
  const path = `/static/${assetId}/tweet_events.json`;

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadTweetEvents:entry',message:'Fetching tweet_events.json',data:{assetId,path},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
  // #endregion

  const response = await fetch(path);

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ea7ab7a2-1b4f-4bbc-9332-76465fb6da64',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dataLoader.ts:loadTweetEvents:response',message:'tweet_events.json response',data:{assetId,path,status:response.status,ok:response.ok,contentType:response.headers.get('content-type')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
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
  
  const path = `/static/${assetId}/stats.json`;
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
