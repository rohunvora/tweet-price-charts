'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// =============================================================================
// Live Price Hook
// =============================================================================
// Polls the /api/price/[asset] endpoint at 1-minute intervals for real-time
// price updates. Returns the latest price and a "live" status indicator.
//
// Features:
// - Automatic polling with visibility-aware pausing
// - Error handling with graceful degradation
// - Deduplication of concurrent requests
// =============================================================================

interface LivePriceData {
  price: number;
  timestamp: number;
  source: string;
}

interface UseLivePriceReturn {
  /** Current live price (null if not yet fetched or error) */
  livePrice: number | null;
  /** Unix timestamp of the live price */
  liveTimestamp: number | null;
  /** Whether the live price is currently being fetched */
  loading: boolean;
  /** Whether we have a valid live connection */
  isLive: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Force an immediate refresh */
  refresh: () => void;
}

const POLL_INTERVAL = 60_000; // 1 minute
const STALE_THRESHOLD = 120_000; // 2 minutes - consider data stale if older

export function useLivePrice(assetId: string): UseLivePriceReturn {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveTimestamp, setLiveTimestamp] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  // Track last successful fetch to detect staleness
  const lastFetchRef = useRef<number>(0);
  const fetchingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrice = useCallback(async () => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);

    try {
      const response = await fetch(`/api/price/${assetId}`, {
        // Bypass browser cache to always get fresh data from edge
        cache: 'no-store',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const data: LivePriceData = await response.json();

      setLivePrice(data.price);
      setLiveTimestamp(data.timestamp);
      setError(null);
      setIsLive(true);
      lastFetchRef.current = Date.now();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[useLivePrice] Failed to fetch ${assetId}:`, message);
      setError(message);
      setIsLive(false);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [assetId]);

  // Start/stop polling based on document visibility
  useEffect(() => {
    const startPolling = () => {
      // Fetch immediately on mount
      fetchPrice();

      // Then poll at interval
      intervalRef.current = setInterval(fetchPrice, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Check if data is stale and refresh if needed
        const timeSinceLastFetch = Date.now() - lastFetchRef.current;
        if (timeSinceLastFetch > STALE_THRESHOLD) {
          setIsLive(false); // Show stale indicator
        }
        startPolling();
      }
    };

    // Initial setup
    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchPrice]);

  // Reset when asset changes
  useEffect(() => {
    setLivePrice(null);
    setLiveTimestamp(null);
    setError(null);
    setIsLive(false);
    lastFetchRef.current = 0;
  }, [assetId]);

  return {
    livePrice,
    liveTimestamp,
    loading,
    isLive,
    error,
    refresh: fetchPrice,
  };
}
