import { PriceData, TweetEventsData, Stats, Timeframe, Candle, TweetEvent } from './types';

// Cache for loaded data
const priceCache = new Map<string, PriceData>();
const tweetCache: TweetEventsData | null = null;
const statsCache: Stats | null = null;

/**
 * Determine optimal timeframe based on visible range (days)
 */
export function getTimeframeForRange(visibleDays: number): Timeframe {
  if (visibleDays > 180) return '1d';
  if (visibleDays > 30) return '1h';
  if (visibleDays > 7) return '15m';
  return '1m';
}

/**
 * Load price data for a specific timeframe
 */
export async function loadPrices(timeframe: Timeframe): Promise<PriceData> {
  const cacheKey = timeframe;
  
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey)!;
  }
  
  // For 1m, we need to load the index and potentially multiple chunks
  if (timeframe === '1m') {
    return load1mPrices();
  }
  
  const response = await fetch(`/data/prices_${timeframe}.json`);
  const data: PriceData = await response.json();
  
  priceCache.set(cacheKey, data);
  return data;
}

/**
 * Load 1m prices (chunked by month)
 */
async function load1mPrices(): Promise<PriceData> {
  if (priceCache.has('1m')) {
    return priceCache.get('1m')!;
  }
  
  // Load index
  const indexResponse = await fetch('/data/prices_1m_index.json');
  const index = await indexResponse.json();
  
  // Load all chunks in parallel
  const chunkPromises = index.chunks.map(async (chunk: { file: string }) => {
    const response = await fetch(`/data/${chunk.file}`);
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
  
  priceCache.set('1m', merged);
  return merged;
}

/**
 * Load tweet events
 */
export async function loadTweetEvents(): Promise<TweetEventsData> {
  const response = await fetch('/data/tweet_events.json');
  return response.json();
}

/**
 * Load pre-computed statistics
 */
export async function loadStats(): Promise<Stats> {
  const response = await fetch('/data/stats.json');
  return response.json();
}

/**
 * Convert price data to Lightweight Charts format
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
 * Filter candles to visible range
 */
export function filterCandlesToRange(
  candles: Candle[],
  startTime: number,
  endTime: number
): Candle[] {
  return candles.filter(c => c.t >= startTime && c.t <= endTime);
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
 * Find the closest SOL candle to a given timestamp
 */
export function findClosestSolCandle(
  timestamp: number,
  solCandles: Candle[],
  maxDiffSeconds: number
): Candle | null {
  if (solCandles.length === 0) return null;
  
  // Binary search for closest candle
  let left = 0;
  let right = solCandles.length - 1;
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (solCandles[mid].t < timestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  
  // Check neighbors for closest
  let closest = solCandles[left];
  let minDiff = Math.abs(closest.t - timestamp);
  
  if (left > 0) {
    const prevDiff = Math.abs(solCandles[left - 1].t - timestamp);
    if (prevDiff < minDiff) {
      closest = solCandles[left - 1];
      minDiff = prevDiff;
    }
  }
  
  if (minDiff > maxDiffSeconds) return null;
  return closest;
}

/**
 * Calculate return between two prices
 */
export function calculateReturn(current: number, previous: number): number {
  if (previous === 0) return 0;
  return (current - previous) / previous;
}

