import { PriceData, TweetEventsData, Stats, Timeframe, Candle, TweetEvent } from './types';

// Cache for loaded data
const priceCache = new Map<string, PriceData>();

/**
 * Determine optimal timeframe based on visible range (days)
 */
export function getTimeframeForRange(visibleDays: number): Timeframe {
  if (visibleDays > 180) return '1d';
  if (visibleDays > 30) return '4h';
  if (visibleDays > 7) return '1h';
  return '15m';
}

/**
 * Load price data for a specific timeframe
 */
export async function loadPrices(timeframe: Timeframe): Promise<PriceData> {
  const cacheKey = timeframe;
  
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey)!;
  }
  
  const response = await fetch(`/data/prices_${timeframe}.json`);
  const data: PriceData = await response.json();
  
  priceCache.set(cacheKey, data);
  return data;
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
