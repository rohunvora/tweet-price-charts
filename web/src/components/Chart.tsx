'use client';

/**
 * =============================================================================
 * Chart.tsx - Interactive Price Chart with Tweet Markers
 * =============================================================================
 *
 * PURPOSE:
 * Displays cryptocurrency price data with founder tweet markers overlaid.
 * The core value proposition is showing the relationship between tweets and
 * price movement - users can see "what did the founder say, and what happened
 * to the price?"
 *
 * KEY FEATURES:
 * 1. Candlestick price chart (via lightweight-charts library)
 * 2. Tweet markers that cluster when zoomed out (X-axis only clustering)
 * 3. Silence gap lines showing price change during periods of no tweets
 * 4. Semantic zoom: labels appear/disappear based on zoom level
 * 5. Click-to-drill-down on clusters with eager timeframe switching
 *
 * ARCHITECTURE DECISIONS:
 * - Markers are drawn on a separate canvas overlay (not lightweight-charts markers)
 *   because we need custom clustering, animations, and hover behavior
 * - Clustering uses "drifting center" algorithm where cluster center moves
 *   toward each new tweet, allowing accumulation over wider ranges
 * - Gap statistics use actual tweet boundaries (firstTweet/lastTweet) not
 *   cluster averages, ensuring zoom-independent % calculations
 *
 * PERFORMANCE NOTES:
 * - Tested with 420+ tweets (USELESS) and 306 tweets (ASTER)
 * - drawMarkers() is called on every pan/zoom, must stay fast
 * - Binary search used for finding nearest candle times
 *
 * MAINTENANCE HISTORY:
 * - Original clustering used fixed threshold, changed to adaptive (bubbleSize + 8)
 * - Gap lines originally required 24h threshold, now draw always with
 *   adaptive label threshold (semantic zoom pattern)
 * - Timeframe switching changed from conservative to eager on cluster click
 *
 * =============================================================================
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CrosshairMode,
  MouseEventParams,
} from 'lightweight-charts';
import { Timeframe, TweetEvent, Candle, Asset } from '@/lib/types';
import { loadPrices, toCandlestickData, getSortedTweetTimestamps } from '@/lib/dataLoader';
import { formatTimeGap, formatPctChange } from '@/lib/formatters';


// =============================================================================
// CONSTANTS - Thresholds and Configuration
// =============================================================================
//
// IMPORTANT: These values have been tuned through testing on dense datasets
// (USELESS: 420 tweets, ASTER: 306 tweets). Change with caution.
// =============================================================================

/**
 * Maximum gap threshold for showing labels on silence gap lines.
 * Used as the CEILING for adaptive label threshold calculation.
 *
 * Why 24 hours: Represents a "significant" silence when viewing all-time data.
 * Shorter gaps are still connected with lines, but don't get labels to avoid clutter.
 */
const SILENCE_GAP_THRESHOLD = 24 * 60 * 60; // 24 hours in seconds

/**
 * Chart theme colors - Premium dark theme
 * Derived from reference designs (Crypto Dashboard, Parlay Banditz)
 * Candlestick colors are intentionally muted (60-80% opacity) so tweet
 * markers stand out as the primary visual element.
 */
const COLORS = {
  // Base theme - warm-tinted black (not pure void)
  // #0D0C0B has subtle warmth that lets colors harmonize instead of float
  background: '#0D0C0B',      // Surface-0: Warm-tinted black
  surface1: '#0F0F12',        // Card background
  surface2: '#161619',        // Elevated elements
  text: '#FAFAFA',            // Primary text
  textMuted: '#71717A',       // Muted/tertiary text
  textSecondary: '#A1A1AA',   // Secondary text
  gridLines: '#161619',       // Subtle grid
  border: 'rgba(255, 255, 255, 0.08)', // Near-invisible borders
  crosshair: '#52525B',

  // Candlestick colors - Custom desaturated palette (the "stage", not the star)
  // Teal-green (#5EBAA2) and dusty coral (#D87E88) - neither TradingView nor Tailwind
  // These recede visually while maintaining semantic meaning (green=up, red=down)
  candleUp: 'rgba(94, 186, 162, 0.35)',      // Teal-green: sophisticated, recedes
  candleDown: 'rgba(216, 126, 136, 0.35)',   // Dusty coral: soft, not aggressive
  candleBorderUp: 'rgba(94, 186, 162, 0.48)',
  candleBorderDown: 'rgba(216, 126, 136, 0.48)',

  // Default marker colors (overridden by asset.color)
  markerPrimary: '#3B82F6',   // Accent blue
  markerHoverGlow: 'rgba(59, 130, 246, 0.2)',    // 20% opacity for subtle hover
  markerMultipleGlow: 'rgba(59, 130, 246, 0.25)', // 25% opacity for multi-tweet

  // Price change indicator colors (matching design tokens)
  positive: '#22C55E',  // Vibrant green
  negative: '#EF4444',  // Vibrant red
} as const;

/**
 * Safely convert any color format to rgba with specified alpha.
 * Handles hex (#RGB, #RRGGBB), rgb(), and rgba() formats.
 */
function withAlpha(color: string, alpha: number): string {
  // Handle hex colors
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    // Expand shorthand (#RGB -> #RRGGBB)
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Handle rgb/rgba
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
  }
  // Fallback - return original (shouldn't happen with valid colors)
  return color;
}

/**
 * Available timeframe options shown in the UI.
 * 1m is excluded because it generates too much data and is rarely useful
 * for the tweet-to-price analysis use case.
 */
const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '1D', value: '1d' },
];

// =============================================================================
// TYPES
// =============================================================================

/** Props for the Chart component */
interface ChartProps {
  tweetEvents: TweetEvent[];  // All tweets for this asset (pre-sorted by timestamp)
  asset: Asset;               // Asset metadata (id, name, founder, color)
}

/**
 * Internal representation of a tweet cluster for rendering.
 *
 * CLUSTERING EXPLAINED:
 * When tweets are close together on the X-axis (time), they get merged into
 * a single visual cluster to prevent overlap. The cluster tracks:
 * - Visual position (x, y): Where to draw the bubble (uses averages)
 * - Statistics (firstTweet, lastTweet): For calculating gap stats (actual boundaries)
 *
 * WHY SEPARATE VISUAL VS STATISTICAL POSITIONS:
 * Visual: Average position keeps the bubble centered over the tweets it represents
 * Statistical: Actual boundaries ensure % changes are zoom-independent
 */
interface TweetClusterDisplay {
  tweets: TweetEvent[];       // All tweets in this cluster

  // Visual positioning (where to draw the bubble)
  x: number;                  // Screen X coordinate (drifting average)
  y: number;                  // Screen Y coordinate (from avgPrice)
  avgPrice: number;           // Average price of all tweets in cluster
  avgTimestamp: number;       // Average timestamp (for sorting)
  avgChange: number | null;   // Average 1h price change (for potential future use)

  // Statistical boundaries (for gap calculations)
  // Using actual tweet boundaries ensures % change is consistent regardless of zoom
  firstTweet: TweetEvent;     // Chronologically first tweet in cluster
  lastTweet: TweetEvent;      // Chronologically last tweet in cluster

  // Gap statistics (calculated after all clusters are built)
  timeSincePrev: number | null;  // Seconds since previous cluster's lastTweet
  pctSincePrev: number | null;   // Price % change during that gap
}


// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Interactive price chart with tweet markers overlaid.
 *
 * This is the main visualization component showing the relationship between
 * founder tweets and token price movement.
 *
 * @param tweetEvents - All tweets for this asset, with price data attached
 * @param asset - Asset metadata including founder info and theme color
 */
export default function Chart({ tweetEvents, asset }: ChartProps) {

  // ===========================================================================
  // REFS - Mutable values that persist across renders
  // ===========================================================================
  //
  // We use refs extensively to avoid stale closure issues in callbacks.
  // When a callback is created (e.g., in useCallback), it captures the values
  // at creation time. Refs let us always access the current value.
  // ===========================================================================

  // DOM element refs
  const containerRef = useRef<HTMLDivElement>(null);      // Chart container div
  const markersCanvasRef = useRef<HTMLCanvasElement | null>(null);  // Overlay canvas for markers
  const avatarRef = useRef<HTMLImageElement | null>(null);  // Cached founder avatar image

  // Lightweight-charts refs
  const chartRef = useRef<IChartApi | null>(null);        // Chart instance
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);  // Candlestick series

  // Data refs (synced from props/state to avoid stale closures)
  const tweetEventsRef = useRef(tweetEvents);             // Current tweets
  const showBubblesRef = useRef(true);                    // Whether markers are visible
  const hoveredTweetRef = useRef<TweetEvent | null>(null);  // Currently hovered tweet
  const candleTimesRef = useRef<number[]>([]);            // Array of candle timestamps (for binary search)
  const candlesRef = useRef<Candle[]>([]);                // Current candle data
  const sortedTweetTimestampsRef = useRef<number[]>([]);  // Pre-sorted tweet timestamps
  const assetRef = useRef(asset);                         // Current asset

  // Cluster and zoom refs
  const clustersRef = useRef<TweetClusterDisplay[]>([]);  // Current visible clusters (for click detection)
  const pendingZoomRef = useRef<{from: number, to: number} | null>(null);  // Zoom target after TF switch
  const bubbleAnimRef = useRef<{start: number, active: boolean}>({start: 0, active: false});  // Entrance animation state
  const zoomToClusterRef = useRef<((cluster: TweetClusterDisplay) => void) | null>(null);  // Zoom function ref
  const animateToRangeRef = useRef<((from: number, to: number) => void) | null>(null);  // Animate function ref

  // ===========================================================================
  // STATE - Values that trigger re-renders when changed
  // ===========================================================================

  const [timeframe, setTimeframe] = useState<Timeframe>('1d');  // Current timeframe (1d, 1h, 15m)
  const [loading, setLoading] = useState(true);           // Data loading indicator
  const [showBubbles, setShowBubbles] = useState(true);   // Toggle tweet markers visibility
  const [hoveredTweet, setHoveredTweet] = useState<TweetEvent | null>(null);  // Tooltip state
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });  // Tooltip screen position
  const [dataLoaded, setDataLoaded] = useState(false);    // Has initial data loaded?
  const [avatarLoaded, setAvatarLoaded] = useState(false);  // Has avatar image loaded?
  const [availableTimeframes, setAvailableTimeframes] = useState<Set<Timeframe>>(new Set(['1d']));  // Which TFs have data
  const [noData, setNoData] = useState(false);            // No data available for current TF
  const [containerWidth, setContainerWidth] = useState(800);  // For tooltip positioning

  // ===========================================================================
  // REF SYNC EFFECTS - Keep refs in sync with props/state
  // ===========================================================================
  //
  // These effects ensure our refs always have the latest values, so callbacks
  // created with useCallback don't have stale data.
  // ===========================================================================

  useEffect(() => { tweetEventsRef.current = tweetEvents; }, [tweetEvents]);
  useEffect(() => { showBubblesRef.current = showBubbles; }, [showBubbles]);
  useEffect(() => { hoveredTweetRef.current = hoveredTweet; }, [hoveredTweet]);
  useEffect(() => { assetRef.current = asset; }, [asset]);
  useEffect(() => {
    sortedTweetTimestampsRef.current = getSortedTweetTimestamps(tweetEvents);
  }, [tweetEvents]);

  // ===========================================================================
  // HELPER: Find nearest candle time (binary search)
  // ===========================================================================
  //
  // Given a tweet timestamp, find the candle that's closest in time.
  // This is used to position tweet markers on the X-axis - we snap them
  // to the nearest candle so they align with the price data.
  //
  // Performance: O(log n) - critical for smooth pan/zoom with many tweets
  // ===========================================================================

  const findNearestCandleTime = useCallback((timestamp: number): number | null => {
    const times = candleTimesRef.current;
    if (times.length === 0) return null;

    let left = 0;
    let right = times.length - 1;

    // Binary search: find insertion point for timestamp
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (times[mid] < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Binary search gives us the first candle >= timestamp
    // But the previous candle might actually be closer
    if (left > 0) {
      const diffLeft = Math.abs(times[left] - timestamp);
      const diffPrev = Math.abs(times[left - 1] - timestamp);
      if (diffPrev < diffLeft) return times[left - 1];
    }
    return times[left];
  }, []);

  // ===========================================================================
  // EFFECT: Load founder avatar image
  // ===========================================================================
  //
  // Pre-loads the founder's avatar so we can draw it in marker bubbles.
  // Falls back gracefully if avatar is missing (uses colored circle instead).
  // ===========================================================================

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';  // Required for canvas drawImage
    img.src = `/avatars/${asset.founder}.png`;
    img.onload = () => {
      avatarRef.current = img;
      setAvatarLoaded(true);
    };
    img.onerror = () => {
      avatarRef.current = null;
      setAvatarLoaded(true);  // Still set true so markers render
    };
  }, [asset.founder]);

  // ===========================================================================
  // DRAW MARKERS - Main rendering function for tweet markers and gap lines
  // ===========================================================================
  //
  // This is the core visualization logic. It runs on every pan/zoom, so
  // performance matters. The function does four things:
  //
  // 1. BUILD CLUSTERS: Group nearby tweets (X-axis only) into visual clusters
  // 2. DRAW GAP LINES: Connect clusters with dashed lines showing silence periods
  // 3. DRAW ONGOING SILENCE: Show line from last tweet to current price
  // 4. DRAW MARKERS: Render the actual bubble markers with avatars/badges
  //
  // CLUSTERING ALGORITHM:
  // - Uses "drifting center": as tweets are added, cluster center moves toward them
  // - Threshold scales with bubble size (adaptive to zoom level)
  // - X-axis only: tweets at different prices but same time cluster together
  //
  // GAP STATISTICS:
  // - Uses actual tweet boundaries (firstTweet/lastTweet), not cluster averages
  // - This ensures % change is consistent regardless of zoom level
  //
  // LABEL VISIBILITY (Semantic Zoom):
  // - Labels appear for gaps > 5% of visible time range
  // - Floor: 30 minutes (always show labels for 30min+ gaps when zoomed in)
  // - Ceiling: 24 hours (don't show labels for < 24h gaps when zoomed out)
  //
  // ===========================================================================

  const drawMarkers = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = markersCanvasRef.current;
    const container = containerRef.current;
    const allTweets = tweetEventsRef.current;
    const showTweets = showBubblesRef.current;
    const hovered = hoveredTweetRef.current;
    const avatar = avatarRef.current;
    const currentAsset = assetRef.current;
    const markerColor = currentAsset.color;
    const markerGlow = `${markerColor}4D`; // 30% opacity
    const markerMultipleGlow = `${markerColor}66`; // 40% opacity

    if (!canvas || !container) return;

    // Set up canvas for HiDPI displays
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // -------------------------------------------------------------------------
    // Premium 4-pass glow for silence lines (the HERO element)
    // Graduated falloff creates organic "luminous" quality vs. simple blur
    // Glow intensity scales with price change magnitude - big moves glow bright
    // -------------------------------------------------------------------------
    const drawSilenceLineWithGlow = (
      startX: number, startY: number,
      endX: number, endY: number,
      color: string,  // hex color e.g. "#22C55E" or "rgba(...)"
      magnitude: number = 10  // % price change - scales glow intensity
    ) => {
      // Convert rgba to hex if needed for glow suffixing
      const hexColor = color.startsWith('rgba') 
        ? (color.includes('239, 83, 80') ? '#EF5350' : '#22C55E')
        : color;
      
      // Scale glow intensity by magnitude: 5% = subtle (0.3), 50%+ = max (1.0)
      // This makes big price moves visually prominent, small moves subtle
      const clampedMag = Math.max(5, Math.min(Math.abs(magnitude), 50));
      const intensity = 0.3 + ((clampedMag - 5) / 45) * 0.7;
      
      ctx.save();
      ctx.setLineDash([6, 8]);
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;  // Slightly thicker for hero prominence
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      // 4-pass graduated glow for smooth organic falloff
      // Each pass creates a layer of the glow halo
      // Alpha values scale with intensity (magnitude-driven)
      const glowPasses = [
        { blur: 24 * intensity, alpha: 0.03 * intensity },  // Atmospheric haze
        { blur: 12 * intensity, alpha: 0.08 * intensity },  // Soft outer glow
        { blur: 6,              alpha: 0.15 * intensity },  // Mid glow (fixed blur)
        { blur: 2,              alpha: 0.25 * intensity },  // Tight core (fixed blur)
      ];
      
      // Draw the path once, then stroke with each glow layer
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      
      // Apply each glow pass (outer to inner)
      glowPasses.forEach(({ blur, alpha }) => {
        // Convert alpha (0-1) to hex string (00-FF)
        const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.shadowColor = hexColor + alphaHex;
        ctx.shadowBlur = blur;
        ctx.strokeStyle = 'transparent';
        ctx.stroke();
      });
      
      // Final pass: the actual visible line (hero prominence)
      ctx.shadowColor = hexColor + '40';  // 25% glow on the line itself
      ctx.shadowBlur = 4;
      ctx.strokeStyle = hexColor + 'CC';  // Line at 80% opacity - HERO
      ctx.stroke();
      
      ctx.restore();
    };

    if (!chart || !series || !showTweets) return;

    const visibleRange = chart.timeScale().getVisibleRange();
    if (!visibleRange) return;
    
    const rangeFrom = visibleRange.from as number;
    const rangeTo = visibleRange.to as number;
    const visibleSeconds = rangeTo - rangeFrom;
    
    // Adaptive sizing: smaller markers when zoomed out, larger when zoomed in
    // zoomFactor: 1.0 at 7 days visible, 0.4 at very zoomed out
    const zoomFactor = Math.min(1, Math.max(0.4, 86400 * 7 / visibleSeconds));
    const bubbleSize = Math.round(24 + 16 * zoomFactor);  // 24-40px
    const bubbleRadius = bubbleSize / 2;

    // Adaptive clustering threshold: scales with bubble size (original behavior)
    const clusterThreshold = bubbleSize + 8;  // 32-48px depending on zoom
    
    // Font sizes for labels
    const timeFontSize = Math.round(8 + 4 * zoomFactor);
    const pctFontSize = Math.round(9 + 4 * zoomFactor);
    const labelSpacing = Math.round(6 + 4 * zoomFactor);

    // Filter to visible tweets with price data
    const visibleTweets = allTweets
      .filter(t => t.price_at_tweet && t.timestamp >= rangeFrom && t.timestamp <= rangeTo)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (visibleTweets.length === 0) {
      clustersRef.current = [];
      return;
    }

    // -------------------------------------------------------------------------
    // Build clusters with X-only clustering + average positioning
    // -------------------------------------------------------------------------
    const clusters: TweetClusterDisplay[] = [];
    
    // Helper to emit a completed cluster
    const emitCluster = (
      tweets: TweetEvent[], 
      clusterX: number, 
      sumPrice: number, 
      sumTimestamp: number, 
      sumChange: number, 
      changeCount: number
    ) => {
      const avgPrice = sumPrice / tweets.length;
      const avgTimestamp = sumTimestamp / tweets.length;
      const avgChange = changeCount > 0 ? sumChange / changeCount : null;
      
      // Get screen Y from average price
      const y = series.priceToCoordinate(avgPrice);
      if (y === null) return;
      
      clusters.push({
        tweets: [...tweets],
        x: clusterX,
        y,
        avgPrice,
        avgTimestamp,
        avgChange,
        // tweets array is already sorted chronologically
        firstTweet: tweets[0],
        lastTweet: tweets[tweets.length - 1],
        timeSincePrev: null,
        pctSincePrev: null,
      });
    };

    let currentTweets: TweetEvent[] = [];
    let clusterX: number | null = null;
    let sumPrice = 0;
    let sumTimestamp = 0;
    let sumChange = 0;
    let changeCount = 0;

    for (const tweet of visibleTweets) {
      const nearestTime = findNearestCandleTime(tweet.timestamp);
      const x = nearestTime ? chart.timeScale().timeToCoordinate(nearestTime as Time) : null;
      if (x === null) continue;

      // X-only clustering: stack if within pixel threshold on time axis
      if (clusterX !== null && Math.abs(x - clusterX) < clusterThreshold) {
        // Add to existing cluster
        currentTweets.push(tweet);
        // Drift cluster center toward new tweet (original behavior)
        clusterX = (clusterX * (currentTweets.length - 1) + x) / currentTweets.length;
        sumPrice += tweet.price_at_tweet!;
        sumTimestamp += tweet.timestamp;
        if (tweet.change_1h_pct !== null) {
          sumChange += tweet.change_1h_pct;
          changeCount++;
        }
      } else {
        // Emit previous cluster if exists
        if (currentTweets.length > 0 && clusterX !== null) {
          emitCluster(currentTweets, clusterX, sumPrice, sumTimestamp, sumChange, changeCount);
        }
        // Start new cluster
        currentTweets = [tweet];
        clusterX = x;
        sumPrice = tweet.price_at_tweet!;
        sumTimestamp = tweet.timestamp;
        sumChange = tweet.change_1h_pct ?? 0;
        changeCount = tweet.change_1h_pct !== null ? 1 : 0;
      }
    }
    
    // Emit final cluster
    if (currentTweets.length > 0 && clusterX !== null) {
      emitCluster(currentTweets, clusterX, sumPrice, sumTimestamp, sumChange, changeCount);
    }

    // Calculate time gaps and price changes between clusters
    // Use actual tweet boundaries (not averages) for zoom-independent statistics
    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1];
      const curr = clusters[i];
      // Time gap: from last tweet of prev cluster to first tweet of current cluster
      curr.timeSincePrev = curr.firstTweet.timestamp - prev.lastTweet.timestamp;
      // Price change: during the actual silence period
      const prevPrice = prev.lastTweet.price_at_tweet;
      const currPrice = curr.firstTweet.price_at_tweet;
      if (prevPrice && currPrice && prevPrice > 0) {
        curr.pctSincePrev = ((currPrice - prevPrice) / prevPrice) * 100;
      }
    }

    // -------------------------------------------------------------------------
    // Draw gap lines between ALL adjacent clusters (with premium glow)
    // Labels use adaptive threshold based on visible time range (semantic zoom)
    // -------------------------------------------------------------------------
    
    // Adaptive label threshold: show labels for "significant" gaps relative to view
    // - Zoomed out (months): 24h gaps are significant
    // - Zoomed in (hours): 30min gaps are significant
    // Scale: 5% of visible range, with floor (30min) and ceiling (24h)
    const adaptiveLabelThreshold = Math.max(1800, Math.min(visibleSeconds * 0.05, SILENCE_GAP_THRESHOLD));

    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1];
      const curr = clusters[i];

      // Use pre-calculated gap from actual tweet boundaries
      const gap = curr.timeSincePrev ?? 0;
      const pctChange = curr.pctSincePrev;
      const isNegative = pctChange !== null && pctChange < 0;
      const lineColor = isNegative ? '#EF5350' : '#22C55E';

      // Line connects marker edges, not centers
      const startX = prev.x + bubbleRadius + 4;
      const endX = curr.x - bubbleRadius - 4;
      const midX = (startX + endX) / 2;
      const midY = (prev.y + curr.y) / 2;
      const lineLength = Math.hypot(endX - startX, curr.y - prev.y);

      // Semantic thresholds for line rendering (not arbitrary pixel counts)
      const hasVisualSpace = endX > startX + 8;       // Minimum to avoid overlap
      const hasMeaningfulGap = gap > 1800;            // 30min+ is semantically significant
      const hasMeaningfulChange = pctChange !== null && Math.abs(pctChange) > 1;  // >1% is worth showing
      const hasMinorGap = gap > 900;                  // 15min+ gets subtle connector

      if (hasVisualSpace) {
        if (hasMeaningfulGap && hasMeaningfulChange) {
          // FULL GLOW: Significant gap with meaningful price change
          drawSilenceLineWithGlow(startX, prev.y, endX, curr.y, lineColor, pctChange ?? 10);

          // Draw labels for significant gaps (adaptive to zoom level)
          if (gap > adaptiveLabelThreshold && lineLength > 60) {
            // Direction-aware label positioning
            // Pump = labels below line (visually "rising"), Dump = labels above line (visually "falling")
            const labelDirection = isNegative ? -1 : 1;  // -1 = above, +1 = below
            const baseOffset = labelDirection * (labelSpacing + 8);

            // Time gap label (boosted visibility)
            ctx.font = `${timeFontSize}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = COLORS.textSecondary;
            ctx.fillText(formatTimeGap(gap), midX, midY + baseOffset);

            // Percentage change label
            ctx.font = `bold ${pctFontSize}px system-ui, sans-serif`;
            ctx.fillStyle = isNegative ? COLORS.negative : COLORS.positive;
            ctx.fillText(formatPctChange(pctChange), midX, midY + baseOffset + labelDirection * labelSpacing);
          }
        } else if (hasMeaningfulGap) {
          // THIN COLORED: 30min+ gap but trivial change (<1%) - show line, no labels
          ctx.save();
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = lineColor + '50';  // 31% opacity
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(startX, prev.y);
          ctx.lineTo(endX, curr.y);
          ctx.stroke();
          ctx.restore();
        } else if (hasMinorGap) {
          // SUBTLE CONNECTOR: 15-30min gap - just a subtle visual link
          ctx.save();
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = COLORS.textMuted + '40';  // Very subtle gray
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(startX, prev.y);
          ctx.lineTo(endX, curr.y);
          ctx.stroke();
          ctx.restore();
        }
        // Gaps <15min: no line (tweets are essentially continuous)
      }
    }
    ctx.setLineDash([]);

    // -------------------------------------------------------------------------
    // Draw ongoing silence indicator (from TRUE last tweet to current price)
    // Only shows if silence exceeds 24h threshold
    // -------------------------------------------------------------------------
    const candles = candlesRef.current;
    
    if (candles.length > 0) {
      // Get TRUE last tweet from all tweets (not just visible)
      const tweetsWithPrice = allTweets.filter(t => t.price_at_tweet);
      if (tweetsWithPrice.length > 0) {
        const trueLastTweet = tweetsWithPrice.reduce((latest, t) => 
          t.timestamp > latest.timestamp ? t : latest
        , tweetsWithPrice[0]);
        
        const latestCandle = candles[candles.length - 1];
        const lastPrice = trueLastTweet.price_at_tweet!;
        const silenceDuration = latestCandle.t - trueLastTweet.timestamp;
        
        // Only show ongoing silence if it exceeds 24h threshold
        if (silenceDuration > SILENCE_GAP_THRESHOLD) {
          // Get screen coordinates for last tweet
          const lastTweetNearestTime = findNearestCandleTime(trueLastTweet.timestamp);
          const lastX = lastTweetNearestTime 
            ? chart.timeScale().timeToCoordinate(lastTweetNearestTime as Time) 
            : null;
          const lastY = series.priceToCoordinate(lastPrice);
          
          const latestX = chart.timeScale().timeToCoordinate(latestCandle.t as Time);
          const latestY = series.priceToCoordinate(latestCandle.c);
          
          // Draw if we have valid coordinates and there's visual space
          if (lastX !== null && lastY !== null && latestX !== null && latestY !== null && latestX > lastX + bubbleRadius) {
            const pctChange = ((latestCandle.c - lastPrice) / lastPrice) * 100;
            const isNegative = pctChange < 0;
            const lineColor = isNegative ? '#EF5350' : '#22C55E';
            
            // Draw dashed line from last tweet to current price (glow intensity scales with magnitude)
            drawSilenceLineWithGlow(lastX + bubbleRadius + 4, lastY, latestX, latestY, lineColor, pctChange);
            
            // Draw labels if enough space
            const lineLength = Math.hypot(latestX - (lastX + bubbleRadius + 4), latestY - lastY);
            if (lineLength > 60) {
              const midX = (lastX + bubbleRadius + 4 + latestX) / 2;
              const midY = (lastY + latestY) / 2;
              
              // Direction-aware label positioning (same pattern as inter-tweet lines)
              const labelDirection = isNegative ? -1 : 1;
              const baseOffset = labelDirection * (labelSpacing + 8);
              
              ctx.font = `${timeFontSize}px system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillStyle = COLORS.textSecondary;  // More visible than textMuted
              ctx.fillText(formatTimeGap(silenceDuration), midX, midY + baseOffset);
              
              ctx.font = `bold ${pctFontSize}px system-ui, sans-serif`;
              ctx.fillStyle = isNegative ? COLORS.negative : COLORS.positive;
              ctx.fillText(formatPctChange(pctChange), midX, midY + baseOffset + labelDirection * labelSpacing);
            }
            
            // Draw "now" dot at current price (subtle live indicator)
            ctx.beginPath();
            ctx.arc(latestX, latestY, 4, 0, Math.PI * 2);
            ctx.fillStyle = isNegative ? COLORS.negative : COLORS.positive;
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Draw clusters with entrance animation
    // -------------------------------------------------------------------------
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const { x, y, tweets } = cluster;
      const count = tweets.length;
      const isMultiple = count > 1;
      const isHovered = tweets.some(t => hovered?.tweet_id === t.tweet_id);

      // Calculate entrance animation scale
      let scale = 1;
      if (bubbleAnimRef.current.active) {
        const elapsed = performance.now() - bubbleAnimRef.current.start;
        const stagger = i * 30;
        const progress = Math.min(Math.max((elapsed - stagger) / 300, 0), 1);
        scale = progress < 1 ? 1 - (1 - progress) ** 3 : 1; // ease-out cubic
        if (elapsed > 400 + clusters.length * 30) {
          bubbleAnimRef.current.active = false;
        }
      }

      // Apply scale to radii
      const scaledRadius = bubbleRadius * scale;
      const scaledSize = bubbleSize * scale;
      
      // Skip drawing if scale is too small
      if (scale < 0.05) continue;

      // Hover glow - subtle, tighter radius
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, scaledRadius + 5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(markerColor, 0.2);
        ctx.fill();
      }

      // Multiple tweets glow - subtle indicator
      if (isMultiple) {
        ctx.beginPath();
        ctx.arc(x, y, scaledRadius + 4, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(markerColor, 0.15);
        ctx.fill();
      }

      // Border ring - muted at rest, accent on hover
      // Markers are locators, not heroes - subtle white ring that doesn't compete
      ctx.beginPath();
      ctx.arc(x, y, scaledRadius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = isHovered ? markerColor : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.stroke();

      // Avatar or fallback circle
      if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, scaledRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, x - scaledRadius, y - scaledRadius, scaledSize, scaledSize);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, scaledRadius, 0, Math.PI * 2);
        ctx.fillStyle = markerColor;
        ctx.fill();
      }

      // Count badge for multiple tweets - subtle but informative
      if (isMultiple && scale > 0.5) {
        const badgeSize = Math.max(12, scaledSize * 0.35);  // Slightly smaller
        const badgeX = x + scaledRadius - badgeSize / 2;
        const badgeY = y - scaledRadius + badgeSize / 3;
        
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeSize / 2 + 2, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(markerColor, 0.9);  // Slightly transparent
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';  // Muted stroke
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${Math.round(badgeSize * 0.7)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count.toString(), badgeX, badgeY);
      }
    }

    // Store clusters for click detection
    clustersRef.current = clusters;

    // Continue animation if active
    if (bubbleAnimRef.current.active) {
      requestAnimationFrame(drawMarkers);
    }
  }, [findNearestCandleTime]);

  // ===========================================================================
  // CHART INITIALIZATION - One-time setup of lightweight-charts instance
  // ===========================================================================
  //
  // Creates the chart and candlestick series, sets up event listeners for:
  // - Resize: Keep chart responsive to container size changes
  // - Pan/Zoom: Redraw markers on time scale changes
  // - Hover: Show tweet tooltips on crosshair movement
  // - Click: Handle cluster click-to-zoom and single tweet tooltip
  //
  // IMPORTANT: This effect runs once on mount. The dependency array includes
  // callback refs that don't change, ensuring stability.
  //
  // ===========================================================================
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const { clientWidth: width, clientHeight: height } = container;

    const chart = createChart(container, {
      width: width || 800,
      height: height || 500,
      layout: {
        background: { color: COLORS.background },
        textColor: COLORS.text,
      },
      grid: {
        vertLines: { color: COLORS.gridLines },
        horzLines: { color: COLORS.gridLines },
      },
      crosshair: {
        // Disable crosshair on touch devices - prevents expensive hit detection during pan/zoom
        // (hover: none) matches devices without a hover-capable pointer (touch screens)
        mode: window.matchMedia('(hover: none)').matches
          ? CrosshairMode.Hidden
          : CrosshairMode.Normal,
        vertLine: { color: COLORS.crosshair, width: 1, style: 0, labelBackgroundColor: COLORS.border },
        horzLine: { color: COLORS.crosshair, width: 1, style: 0, labelBackgroundColor: COLORS.border },
      },
      timeScale: {
        borderColor: COLORS.border,
        // Note: timeScale inherits textColor from layout.textColor
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        minBarSpacing: 0.5,
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        textColor: COLORS.textSecondary,  // Visible price labels
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
      localization: {
        priceFormatter: (price: number) => {
          if (price >= 1) return price.toFixed(2);
          if (price >= 0.01) return price.toFixed(4);
          return price.toFixed(6);
        },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: COLORS.candleUp,
      downColor: COLORS.candleDown,
      borderUpColor: COLORS.candleBorderUp,
      borderDownColor: COLORS.candleBorderDown,
      wickUpColor: COLORS.candleUp,
      wickDownColor: COLORS.candleDown,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // -------------------------------------------------------------------------
    // Resize Observer
    // -------------------------------------------------------------------------
    // Uses double-requestAnimationFrame to let chart finish internal resize
    // before we redraw markers. Without this, marker positions can be stale.
    // -------------------------------------------------------------------------
    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
        setContainerWidth(width);
        // Wait for chart to finish internal resize before redrawing markers
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            drawMarkers();
          });
        });
      }
    });
    resizeObserver.observe(container);

    // -------------------------------------------------------------------------
    // Pan/Zoom Handler
    // -------------------------------------------------------------------------
    // Redraw markers whenever the visible time range changes. Also cancels any
    // pending zoom animation if user manually interacts with the chart.
    // -------------------------------------------------------------------------
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      pendingZoomRef.current = null;
      drawMarkers();
    });

    // -------------------------------------------------------------------------
    // Hover Detection (Desktop Only)
    // -------------------------------------------------------------------------
    // Shows tweet tooltips on hover. Also changes cursor to 'pointer' when
    // hovering over multi-tweet clusters to indicate clickability.
    //
    // MOBILE: Skipped entirely - touch devices use tap (click handler below)
    // and running this on every touch move destroys pan/zoom performance.
    //
    // Note: We iterate through all tweets for precise hit detection, even
    // though clusters are already built. This is because we want to show
    // the specific tweet being hovered, not just the cluster.
    // -------------------------------------------------------------------------
    const isTouchDevice = window.matchMedia('(hover: none)').matches;

    if (!isTouchDevice) {
      chart.subscribeCrosshairMove((param: MouseEventParams) => {
        if (!param.point) {
          setHoveredTweet(null);
          if (container) container.style.cursor = '';
          return;
        }

        const { x, y } = param.point;
        const HOVER_RADIUS = 24;
        const tweets = tweetEventsRef.current;

        // Check for multi-tweet cluster hover (cursor affordance)
        const overMultiCluster = clustersRef.current.some(
          c => c.tweets.length > 1 && Math.hypot(c.x - x, c.y - y) < HOVER_RADIUS
        );
        if (container) container.style.cursor = overMultiCluster ? 'pointer' : '';

        for (const tweet of tweets) {
          if (!tweet.price_at_tweet) continue;

          const nearestTime = findNearestCandleTime(tweet.timestamp);
          const tx = nearestTime ? chart.timeScale().timeToCoordinate(nearestTime as Time) : null;
          const ty = series.priceToCoordinate(tweet.price_at_tweet);

          if (tx !== null && ty !== null && Math.hypot(tx - x, ty - y) < HOVER_RADIUS) {
            setHoveredTweet(tweet);
            setTooltipPos({ x: tx, y: ty });
            return;
          }
        }
        setHoveredTweet(null);
      });
    }

    // -------------------------------------------------------------------------
    // Click Handler
    // -------------------------------------------------------------------------
    // Unified behavior for desktop and mobile:
    // - Multi-tweet cluster: Zoom in to show individual tweets
    // - Single tweet: Show tooltip (especially useful on mobile where hover
    //   doesn't work)
    // - Tap outside: Dismiss tooltip
    //
    // Uses clustersRef (populated by drawMarkers) for hit detection.
    // -------------------------------------------------------------------------
    chart.subscribeClick((param: MouseEventParams) => {
      if (!param.point) return;

      const { x, y } = param.point;
      const CLICK_RADIUS = 24;

      for (const cluster of clustersRef.current) {
        if (Math.hypot(cluster.x - x, cluster.y - y) < CLICK_RADIUS) {
          if (cluster.tweets.length > 1) {
            // Multi-tweet cluster: zoom in to show individual tweets
            zoomToClusterRef.current?.(cluster);
          } else {
            // Single tweet: show tooltip (useful for mobile where hover doesn't work)
            const tweet = cluster.tweets[0];
            setHoveredTweet(tweet);
            setTooltipPos({ x: cluster.x, y: cluster.y });
          }
          return;
        }
      }
      
      // Tap outside bubbles dismisses tooltip
      setHoveredTweet(null);
    });

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [drawMarkers, findNearestCandleTime]);

  // ===========================================================================
  // DETECT AVAILABLE TIMEFRAMES - Check which data files exist for this asset
  // ===========================================================================
  //
  // Different assets have different data availability:
  // - Memecoins (USELESS, JUP): May have DEX 1m data via Birdeye
  // - CoinGecko-only assets (ASTER): Only 1d data available
  //
  // We use HEAD requests to check file existence without downloading data.
  // The result is used to:
  // - Gray out unavailable timeframe buttons
  // - Auto-switch to 1d if current timeframe becomes unavailable
  //
  // ===========================================================================
  useEffect(() => {
    async function detectTimeframes() {
      const available = new Set<Timeframe>();

      // Check each timeframe by trying to fetch it
      for (const tf of ['1d', '1h', '15m', '1m'] as Timeframe[]) {
        try {
          const path = tf === '1m'
            ? `/static/${asset.id}/prices_1m_index.json`
            : `/static/${asset.id}/prices_${tf}.json`;
          const response = await fetch(path, { method: 'HEAD' });
          if (response.ok) {
            available.add(tf);
          }
        } catch {
          // Timeframe not available
        }
      }

      // Always include 1d as fallback
      if (available.size === 0) available.add('1d');

      setAvailableTimeframes(available);

      // If current timeframe is not available, switch to 1d
      if (!available.has(timeframe)) {
        setTimeframe('1d');
      }
    }
    detectTimeframes();
  }, [asset.id]);

  // ===========================================================================
  // LOAD PRICE DATA - Fetch candle data and set up chart
  // ===========================================================================
  //
  // This effect runs whenever timeframe or asset changes. It:
  // 1. Fetches the price data for the selected timeframe
  // 2. Sets the data on the candlestick series
  // 3. Handles three different zoom scenarios:
  //    a) pendingZoomRef: Cluster click triggered a TF switch - animate to target
  //    b) previousRange: Manual TF switch - preserve center position (TradingView UX)
  //    c) Initial load: Smart default (show last N candles or fit content)
  //
  // The range preservation logic is critical for good UX - users expect to stay
  // in the same "area" when switching timeframes, not jump to a random location.
  //
  // ===========================================================================
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setDataLoaded(false);
      setNoData(false);

      try {
        const priceData = await loadPrices(timeframe, asset.id);

        // Handle empty data gracefully
        if (priceData.candles.length === 0) {
          setNoData(true);
          setLoading(false);
          return;
        }

        candlesRef.current = priceData.candles;
        candleTimesRef.current = priceData.candles.map(c => c.t);

        if (seriesRef.current && chartRef.current) {
          // -----------------------------------------------------------------------
          // CRITICAL: Capture previous range BEFORE setData clears it
          // -----------------------------------------------------------------------
          // setData() resets the chart's internal state. If we want to preserve
          // the user's position (e.g., they were looking at a specific date range),
          // we need to capture that range before the reset and restore it after.
          // -----------------------------------------------------------------------
          const previousRange = chartRef.current.timeScale().getVisibleRange();

          const chartData = toCandlestickData(priceData);
          seriesRef.current.setData(chartData as CandlestickData<Time>[]);

          if (pendingZoomRef.current) {
            // -----------------------------------------------------------------------
            // SCENARIO A: Cluster Click Zoom
            // -----------------------------------------------------------------------
            // User clicked a multi-tweet cluster. We switched timeframes and set
            // pendingZoomRef with the target range. Now animate to that range.
            // -----------------------------------------------------------------------
            const { from, to } = pendingZoomRef.current;
            pendingZoomRef.current = null;

            // RAF lets chart finish internal layout after setData
            requestAnimationFrame(() => {
              if (previousRange && animateToRangeRef.current) {
                // Smooth animation from previous position to target
                animateToRangeRef.current(from, to);
              } else {
                // No previous position (shouldn't happen), set directly
                chartRef.current?.timeScale().setVisibleRange({
                  from: from as Time,
                  to: to as Time
                });
              }
            });
          } else if (previousRange) {
            // -----------------------------------------------------------------------
            // SCENARIO B: Manual Timeframe Switch
            // -----------------------------------------------------------------------
            // User clicked a timeframe button (1D→1h, etc). Preserve the center of
            // their view - this is the TradingView pattern users expect.
            // -----------------------------------------------------------------------
            const candles = priceData.candles;
            const dataStart = candles[0].t;
            const dataEnd = candles[candles.length - 1].t;

            requestAnimationFrame(() => {
              if (!chartRef.current) return;

              const prevCenter = ((previousRange.from as number) + (previousRange.to as number)) / 2;
              const prevSpan = (previousRange.to as number) - (previousRange.from as number);
              let newFrom = prevCenter - prevSpan / 2;
              let newTo = prevCenter + prevSpan / 2;

              // Clamp range to actual data bounds to avoid null coordinate errors
              if (newFrom < dataStart) {
                newFrom = dataStart;
                newTo = Math.min(dataStart + prevSpan, dataEnd);
              }
              if (newTo > dataEnd) {
                newTo = dataEnd;
                newFrom = Math.max(dataEnd - prevSpan, dataStart);
              }

              chartRef.current.timeScale().setVisibleRange({
                from: newFrom as Time,
                to: newTo as Time
              });
            });
          } else {
            // -----------------------------------------------------------------------
            // SCENARIO C: Initial Load
            // -----------------------------------------------------------------------
            // First time loading this asset. Show a reasonable default view:
            // - If < 500 candles: fit all content
            // - If > 500 candles: show last 500 (keeps candles visible)
            // -----------------------------------------------------------------------
            const candles = priceData.candles;
            const MAX_VISIBLE_CANDLES = 500;

            requestAnimationFrame(() => {
              if (!chartRef.current) return;

              if (candles.length > MAX_VISIBLE_CANDLES) {
                // Show last N candles to ensure visibility
                const fromCandle = candles[candles.length - MAX_VISIBLE_CANDLES];
                const toCandle = candles[candles.length - 1];
                const padding = (toCandle.t - fromCandle.t) * 0.05;
                chartRef.current.timeScale().setVisibleRange({
                  from: fromCandle.t as Time,
                  to: (toCandle.t + padding) as Time,
                });
              } else {
                chartRef.current.timeScale().fitContent();
              }
            });
          }

          setDataLoaded(true);

          // Trigger bubble entrance animation
          bubbleAnimRef.current = { start: performance.now(), active: true };
        }
      } catch (error) {
        console.error(`[Chart] Failed to load price data:`, error);
        setNoData(true);
      }
      setLoading(false);
    }
    loadData();
  }, [timeframe, tweetEvents, asset.id]);

  // ===========================================================================
  // MARKER REDRAW TRIGGER - Redraw when relevant state changes
  // ===========================================================================
  //
  // The 50ms timeout debounces rapid state changes. This effect handles:
  // - Data loaded: Initial marker draw after price data arrives
  // - showBubbles: Toggle marker visibility
  // - hoveredTweet: Highlight state changes
  // - avatarLoaded: Redraw once avatar image is ready
  //
  // ===========================================================================
  useEffect(() => {
    if (dataLoaded) {
      const timer = setTimeout(drawMarkers, 50);
      return () => clearTimeout(timer);
    }
  }, [dataLoaded, showBubbles, hoveredTweet, avatarLoaded, drawMarkers]);

  // ===========================================================================
  // NAVIGATION HANDLERS - Quick navigation buttons
  // ===========================================================================
  //
  // These provide shortcuts for common navigation patterns:
  // - jumpToLastTweet: Focus on the most recent activity
  // - jumpToAllTime: See the full price history
  //
  // ===========================================================================

  /**
   * Jump to view the most recent tweet with 7 days of context.
   * Shows the last tweet on the left with current price on the right.
   */
  const jumpToLastTweet = useCallback(() => {
    if (!chartRef.current || tweetEvents.length === 0) return;
    
    const tweetsWithPrice = tweetEvents.filter(t => t.price_at_tweet !== null);
    if (tweetsWithPrice.length === 0) return;
    
    const lastTweet = tweetsWithPrice[tweetsWithPrice.length - 1];
    const now = Math.floor(Date.now() / 1000);
    const from = lastTweet.timestamp - (7 * 24 * 60 * 60);
    
    chartRef.current.timeScale().setVisibleRange({
      from: from as Time,
      to: now as Time,
    });
  }, [tweetEvents]);

  /**
   * Show all available price history.
   * For very large datasets (>2000 candles), adjusts bar spacing to keep
   * candles visible rather than becoming invisible dots.
   */
  const jumpToAllTime = useCallback(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || candles.length === 0) return;

    // For large datasets, enforce minimum bar spacing to keep candles visible
    const MAX_ALL_TIME_CANDLES = 2000;

    if (candles.length > MAX_ALL_TIME_CANDLES) {
      // Show all data but with minimum bar spacing enforced
      // This shows the full range but may not show every candle
      chart.applyOptions({
        timeScale: { minBarSpacing: 1 }
      });
    }
    chart.timeScale().fitContent();
  }, []);

  // ===========================================================================
  // ANIMATION FUNCTIONS - Smooth zoom transitions
  // ===========================================================================
  //
  // These provide fluid animations when zooming to clusters or navigating.
  // Uses ease-out cubic easing for natural deceleration.
  //
  // ===========================================================================

  /**
   * Smoothly animate from current visible range to target range.
   * Uses ease-out cubic easing (fast start, slow finish).
   *
   * @param targetFrom - Target start timestamp (seconds)
   * @param targetTo - Target end timestamp (seconds)
   */
  const animateToRange = useCallback((targetFrom: number, targetTo: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const start = chart.timeScale().getVisibleRange();
    if (!start) {
      chart.timeScale().setVisibleRange({ from: targetFrom as Time, to: targetTo as Time });
      return;
    }
    
    const duration = 300;
    const t0 = performance.now();
    
    (function tick() {
      const t = Math.min((performance.now() - t0) / duration, 1);
      const e = 1 - (1 - t) ** 3; // ease-out cubic
      chart.timeScale().setVisibleRange({
        from: ((start.from as number) + (targetFrom - (start.from as number)) * e) as Time,
        to: ((start.to as number) + (targetTo - (start.to as number)) * e) as Time,
      });
      if (t < 1) requestAnimationFrame(tick);
    })();
  }, []);

  // ===========================================================================
  // ZOOM TO CLUSTER - Handle click on multi-tweet bubble
  // ===========================================================================
  //
  // UX PRINCIPLE: One click = see the detail. Don't make users click multiple
  // times to drill down into a cluster.
  //
  // EAGER TIMEFRAME SWITCHING:
  // - On 1D: ALWAYS switch to 1h (daily candles hide intra-day price action)
  // - On 1h: Switch to 15m if cluster has >3 tweets (they're likely packed)
  // - On 15m: Switch to 1m if cluster has >5 tweets (very dense)
  //
  // WHY NOT CONSERVATIVE?
  // The conservative approach (only switch if time span < N candles) was too
  // cautious. Users clicking on a cluster WANT to see more detail - give it
  // to them immediately rather than making them click timeframe buttons.
  //
  // ===========================================================================
  const zoomToCluster = useCallback((cluster: TweetClusterDisplay) => {
    const chart = chartRef.current;
    if (!chart) return;

    const tweets = cluster.tweets;

    if (tweets.length === 1) {
      // Single tweet - just show tooltip, don't zoom
      setHoveredTweet(tweets[0]);
      setTooltipPos({ x: cluster.x, y: cluster.y });
      return;
    }

    // Calculate range needed to show all tweets in this cluster
    const timeMin = tweets[0].timestamp;
    const timeMax = tweets[tweets.length - 1].timestamp;
    const timeSpan = timeMax - timeMin;

    // Add generous padding (50% on each side, minimum 2 hours)
    const padding = Math.max(timeSpan * 0.5, 7200);
    const targetFrom = timeMin - padding;
    const targetTo = timeMax + padding;

    // Eager timeframe switching: prefer finer timeframes when clicking clusters
    // Daily candles can't show intra-day price movement, so always go to 1h
    // Hourly candles can't show intra-hour movement, so go to 15m for dense clusters
    const order: Timeframe[] = ['1d', '1h', '15m', '1m'];
    const currentIdx = order.indexOf(timeframe);

    // On 1D: always switch to 1h (daily candles hide intra-day price action)
    // On 1h: switch to 15m if cluster has many tweets (they're likely close together)
    // On 15m: switch to 1m if cluster still has many tweets
    const shouldSwitchTF =
      timeframe === '1d' ||  // Always switch from 1D - can't see intra-day movement
      (timeframe === '1h' && tweets.length > 3) ||   // Dense cluster on 1h
      (timeframe === '15m' && tweets.length > 5);    // Very dense cluster on 15m

    if (shouldSwitchTF && currentIdx < order.length - 1) {
      // Find next available finer timeframe
      let finerTF: Timeframe | null = null;
      for (let i = currentIdx + 1; i < order.length; i++) {
        if (availableTimeframes.has(order[i])) {
          finerTF = order[i];
          break;
        }
      }

      if (finerTF) {
        pendingZoomRef.current = { from: targetFrom, to: targetTo };
        setTimeframe(finerTF);
        return;
      }
    }

    // Current timeframe is fine (or no finer available) - just zoom in place
    animateToRange(targetFrom, targetTo);
  }, [timeframe, availableTimeframes, animateToRange]);

  // ===========================================================================
  // REF SYNC - Keep function refs current for callbacks
  // ===========================================================================
  //
  // These refs are used in event handlers that are created once (in the
  // initialization useEffect). Syncing the functions to refs ensures those
  // handlers always call the latest version of the function.
  //
  // ===========================================================================
  useEffect(() => {
    zoomToClusterRef.current = zoomToCluster;
  }, [zoomToCluster]);

  useEffect(() => {
    animateToRangeRef.current = animateToRange;
  }, [animateToRange]);

  // ===========================================================================
  // RENDER - Component JSX
  // ===========================================================================
  //
  // Layout structure:
  // - Container div (relative positioning anchor)
  //   - Chart container (where lightweight-charts renders)
  //   - Markers canvas (overlays chart for custom rendering)
  //   - Top controls (tweet toggle, navigation buttons - desktop only)
  //   - Timeframe selector (bottom bar on mobile, corner on desktop)
  //   - Legend (explains marker symbols - desktop only)
  //   - Loading indicator
  //   - No data message
  //   - Tweet tooltip (positioned relative to hovered marker)
  //
  // MOBILE CONSIDERATIONS:
  // - Bottom bar for timeframe selector (thumb-friendly)
  // - pb-safe for iPhone home indicator
  // - Click-to-show tooltip (no hover on touch)
  //
  // ===========================================================================
  return (
    <div 
      className="relative w-full h-full bg-[#131722]"
      style={{ '--asset-color': asset.color } as React.CSSProperties}
    >
      {/* Chart container */}
      <div ref={containerRef} className="absolute inset-0" />
      
      {/* Markers canvas overlay */}
      <canvas
        ref={markersCanvasRef}
        className="absolute inset-0"
        style={{ zIndex: 10, pointerEvents: 'none' }}
      />

      {/* Top controls - desktop only */}
      <div className="absolute top-2 left-2 z-20 hidden md:flex items-center gap-2">
        <button
          onClick={() => setShowBubbles(!showBubbles)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
            showBubbles 
              ? 'bg-[var(--surface-2)] text-white border border-[var(--border-default)]' 
              : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
        >
          <span>🐦</span>
          <span>Tweets</span>
        </button>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={jumpToLastTweet}
            className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] rounded transition-colors"
          >
            Last Tweet
          </button>
          <button
            onClick={jumpToAllTime}
            className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] rounded transition-colors"
          >
            All Time
          </button>
        </div>
      </div>

      {/* Timeframe selector - top bar on mobile (avoids Safari toolbar), corner on desktop */}
      <div className="absolute z-20
                     top-0 left-0 right-0
                     md:top-auto md:bottom-2 md:left-2 md:right-auto
                     flex items-center justify-around md:justify-start gap-1
                     bg-[var(--surface-1)] md:bg-transparent
                     py-3 md:py-0
                     border-b border-[var(--border-subtle)] md:border-0">
        {TIMEFRAMES.map((tf) => {
          const isAvailable = availableTimeframes.has(tf.value);
          const isActive = timeframe === tf.value;
          return (
            <button
              key={tf.value}
              onClick={() => isAvailable && setTimeframe(tf.value)}
              disabled={!isAvailable}
              title={!isAvailable ? `${tf.label} data not available for ${asset.name}` : undefined}
              className={`px-4 py-2 md:px-2 md:py-1 text-sm md:text-xs font-medium rounded transition-colors ${
                isActive
                  ? 'text-white'
                  : isAvailable
                    ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)] md:hover:bg-[var(--surface-2)]'
                    : 'text-[var(--text-disabled)] cursor-not-allowed'
              }`}
              style={isActive ? { backgroundColor: asset.color } : undefined}
            >
              {tf.label}
            </button>
          );
        })}
        {/* Chart meaning label - mobile only */}
        <span className="md:hidden text-[10px] text-[var(--text-muted)] ml-auto pr-2">
          Move since last tweet
        </span>
      </div>

      {/* Help text - desktop only */}
      <span className="hidden md:block absolute bottom-2 left-32 text-[10px] text-[var(--text-disabled)] select-none z-20">
        Drag to pan • Scroll to zoom
      </span>
      
      {/* Legend - desktop only */}
      {showBubbles && (
        <div className="absolute bottom-14 md:bottom-2 right-2 z-20 hidden md:flex items-center gap-3 bg-[var(--surface-1)]/90 px-3 py-1.5 rounded text-[10px]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border border-white/50 bg-transparent" />
            <span className="text-[var(--text-secondary)]">1 tweet</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <div 
                className="w-3 h-3 rounded-full border border-white/50"
                style={{ backgroundColor: `${asset.color}66` }}
              />
              <span 
                className="absolute -top-0.5 -right-1 text-[7px] text-white font-bold rounded-full w-2.5 h-2.5 flex items-center justify-center"
                style={{ backgroundColor: asset.color }}
              >3</span>
            </div>
            <span className="text-[var(--text-secondary)]">3+ tweets</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 border-t border-dashed border-[var(--negative)]" />
            <span className="text-[var(--text-secondary)]">Quiet period</span>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="absolute top-14 right-2 z-20 flex items-center gap-2 bg-[var(--surface-1)] px-3 py-1 rounded">
          <div
            className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: asset.color, borderTopColor: 'transparent' }}
          />
          <span className="text-xs text-[var(--text-muted)]">Loading {asset.name}...</span>
        </div>
      )}

      {/* No data message */}
      {noData && !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-[var(--surface-0)]/80">
          <div className="text-center p-6 bg-[var(--surface-1)] rounded-lg border border-[var(--border-subtle)]">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-[var(--text-primary)] font-medium mb-1">No {timeframe} data available</div>
            <div className="text-[var(--text-muted)] text-sm mb-3">
              {asset.name} only has daily price data from CoinGecko
            </div>
            <button
              onClick={() => setTimeframe('1d')}
              className="px-4 py-2 text-sm font-medium text-white rounded transition-colors"
              style={{ backgroundColor: asset.color }}
            >
              Switch to 1D
            </button>
          </div>
        </div>
      )}

      {/* Tweet tooltip */}
      {hoveredTweet && (
        <div
          className="absolute z-30 pointer-events-none bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-lg p-3 shadow-xl max-w-xs tooltip-enter"
          style={{
            left: Math.min(tooltipPos.x + 20, containerWidth - 300),
            top: Math.max(tooltipPos.y - 60, 10),
          }}
        >
          <div className="flex items-start gap-2 mb-2">
            <img
              src={`/avatars/${asset.founder}.png`}
              alt={asset.founder}
              className="w-8 h-8 rounded-full bg-[var(--surface-2)]"
            />
            <div>
              <div className="text-[var(--text-primary)] font-medium text-sm">@{asset.founder}</div>
              <div className="text-[var(--text-muted)] text-xs">
                {new Date(hoveredTweet.timestamp * 1000).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
          <p className="text-sm text-[var(--text-primary)] line-clamp-3 mb-2">{hoveredTweet.text}</p>
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>❤️ {hoveredTweet.likes.toLocaleString()}</span>
            <span>🔁 {hoveredTweet.retweets.toLocaleString()}</span>
          </div>
          {hoveredTweet.change_1h_pct !== null && (
            <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex items-center gap-3 text-xs">
              <span className="text-[var(--text-muted)]">After tweet:</span>
              <span className={hoveredTweet.change_1h_pct >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
                1h: {hoveredTweet.change_1h_pct >= 0 ? '+' : ''}{hoveredTweet.change_1h_pct.toFixed(1)}%
              </span>
              {hoveredTweet.change_24h_pct !== null && (
                <span className={hoveredTweet.change_24h_pct >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
                  24h: {hoveredTweet.change_24h_pct >= 0 ? '+' : ''}{hoveredTweet.change_24h_pct.toFixed(1)}%
                </span>
              )}
            </div>
          )}
          {/* Touch hint - only show on touch devices */}
          <div className="mt-2 text-xs md:hidden" style={{ color: asset.color }}>Tap to dismiss</div>
        </div>
      )}
    </div>
  );
}
