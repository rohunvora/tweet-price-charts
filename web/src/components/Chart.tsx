'use client';

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
// Constants
// =============================================================================

/** Silence gap threshold: only show line if gap exceeds 24 hours */
const SILENCE_GAP_THRESHOLD = 24 * 60 * 60; // 24 hours in seconds

/** Chart theme colors (TradingView dark theme inspired) */
const COLORS = {
  background: '#131722',
  text: '#D1D4DC',
  textMuted: '#787B86',
  gridLines: '#1E222D',
  border: '#2A2E39',
  crosshair: '#758696',
  // Candlestick colors (slightly muted to not compete with markers)
  candleUp: 'rgba(38, 166, 154, 0.6)',
  candleDown: 'rgba(239, 83, 80, 0.6)',
  candleBorderUp: 'rgba(38, 166, 154, 0.8)',
  candleBorderDown: 'rgba(239, 83, 80, 0.8)',
  // Marker colors
  markerPrimary: '#2962FF',
  markerHoverGlow: 'rgba(41, 98, 255, 0.3)',
  markerMultipleGlow: 'rgba(41, 98, 255, 0.4)',
  // Price change colors
  positive: '#26A69A',
  negative: '#EF5350',
} as const;

/** Available timeframe options (1m removed - too much data, rarely useful) */
const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '1D', value: '1d' },
];

// =============================================================================
// Types
// =============================================================================

interface ChartProps {
  tweetEvents: TweetEvent[];
  asset: Asset;
}

/** Internal representation of a tweet cluster for rendering */
interface TweetClusterDisplay {
  tweets: TweetEvent[];
  x: number;           // Screen X (avg position for visual centering)
  y: number;           // Screen Y (avg position for visual centering)
  avgPrice: number;
  avgTimestamp: number;
  avgChange: number | null;
  // Actual tweet boundaries for zoom-independent statistics
  firstTweet: TweetEvent;
  lastTweet: TweetEvent;
  timeSincePrev: number | null;
  pctSincePrev: number | null;
}


// =============================================================================
// Component
// =============================================================================

/**
 * Interactive price chart with tweet markers overlaid.
 * 
 * Features:
 * - Candlestick price data from multiple timeframes
 * - Tweet markers that cluster when zoomed out
 * - Silence gap annotations showing price change during tweet gaps
 * - Hover tooltips and click-to-open-tweet
 */
export default function Chart({ tweetEvents, asset }: ChartProps) {
  console.log(`[Chart] Rendering ${asset.name} with ${tweetEvents.length} tweets`);
  
  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarRef = useRef<HTMLImageElement | null>(null);
  
  // Data refs (avoid stale closures in callbacks)
  const tweetEventsRef = useRef(tweetEvents);
  const showBubblesRef = useRef(true);
  const hoveredTweetRef = useRef<TweetEvent | null>(null);
  const candleTimesRef = useRef<number[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const sortedTweetTimestampsRef = useRef<number[]>([]);
  const assetRef = useRef(asset);
  
  // Cluster zoom refs
  const clustersRef = useRef<TweetClusterDisplay[]>([]);
  const pendingZoomRef = useRef<{from: number, to: number} | null>(null);
  const bubbleAnimRef = useRef<{start: number, active: boolean}>({start: 0, active: false});
  const zoomToClusterRef = useRef<((cluster: TweetClusterDisplay) => void) | null>(null);
  const animateToRangeRef = useRef<((from: number, to: number) => void) | null>(null);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [loading, setLoading] = useState(true);
  const [showBubbles, setShowBubbles] = useState(true);
  const [hoveredTweet, setHoveredTweet] = useState<TweetEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [dataLoaded, setDataLoaded] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [availableTimeframes, setAvailableTimeframes] = useState<Set<Timeframe>>(new Set(['1d']));
  const [noData, setNoData] = useState(false);
  const [containerWidth, setContainerWidth] = useState(800);

  // ---------------------------------------------------------------------------
  // Sync refs with state/props
  // ---------------------------------------------------------------------------
  useEffect(() => { tweetEventsRef.current = tweetEvents; }, [tweetEvents]);
  useEffect(() => { showBubblesRef.current = showBubbles; }, [showBubbles]);
  useEffect(() => { hoveredTweetRef.current = hoveredTweet; }, [hoveredTweet]);
  useEffect(() => { assetRef.current = asset; }, [asset]);
  useEffect(() => {
    sortedTweetTimestampsRef.current = getSortedTweetTimestamps(tweetEvents);
  }, [tweetEvents]);

  // ---------------------------------------------------------------------------
  // Helper: Find nearest candle time (binary search)
  // ---------------------------------------------------------------------------
  const findNearestCandleTime = useCallback((timestamp: number): number | null => {
    const times = candleTimesRef.current;
    if (times.length === 0) return null;
    
    let left = 0;
    let right = times.length - 1;
    
    // Binary search for closest candle
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (times[mid] < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    // Check if previous candle is actually closer
    if (left > 0) {
      const diffLeft = Math.abs(times[left] - timestamp);
      const diffPrev = Math.abs(times[left - 1] - timestamp);
      if (diffPrev < diffLeft) return times[left - 1];
    }
    return times[left];
  }, []);

  // ---------------------------------------------------------------------------
  // Load avatar image
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `/avatars/${asset.founder}.png`;
    img.onload = () => {
      console.log(`[Chart] Loaded avatar for ${asset.founder}`);
      avatarRef.current = img;
      setAvatarLoaded(true);
    };
    img.onerror = () => {
      console.warn(`[Chart] Missing avatar for ${asset.founder}, using fallback`);
      avatarRef.current = null;
      setAvatarLoaded(true);
    };
  }, [asset.founder]);

  // ---------------------------------------------------------------------------
  // Draw markers (X-only clustering + 24h gap threshold for lines)
  // ---------------------------------------------------------------------------
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
    // Draw gap lines between ALL adjacent clusters
    // Labels use adaptive threshold based on visible time range (semantic zoom)
    // -------------------------------------------------------------------------
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;

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

      ctx.strokeStyle = isNegative ? 'rgba(239, 83, 80, 0.5)' : 'rgba(38, 166, 154, 0.5)';

      // Line connects marker edges, not centers
      const startX = prev.x + bubbleRadius + 4;
      const endX = curr.x - bubbleRadius - 4;
      const midX = (startX + endX) / 2;
      const midY = (prev.y + curr.y) / 2;

      // Only draw if there's enough visual space for the line
      if (endX > startX + 20) {
        // Draw dashed line (always, for narrative continuity)
        ctx.beginPath();
        ctx.moveTo(startX, prev.y);
        ctx.lineTo(endX, curr.y);
        ctx.stroke();

        // Draw labels for significant gaps (adaptive to zoom level)
        const lineLength = Math.hypot(endX - startX, curr.y - prev.y);
        if (gap > adaptiveLabelThreshold && lineLength > 60) {
          ctx.setLineDash([]);

          // Time gap label
          ctx.font = `${timeFontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = COLORS.textMuted;
          ctx.fillText(formatTimeGap(gap), midX, midY - labelSpacing);

          // Percentage change label
          if (pctChange !== null) {
            ctx.font = `bold ${pctFontSize}px system-ui, sans-serif`;
            ctx.fillStyle = isNegative ? COLORS.negative : COLORS.positive;
            ctx.fillText(formatPctChange(pctChange), midX, midY + labelSpacing);
          }

          ctx.setLineDash([6, 4]);
        }
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
            
            // Draw dashed line from last tweet to current price
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = isNegative ? 'rgba(239, 83, 80, 0.5)' : 'rgba(38, 166, 154, 0.5)';
            ctx.beginPath();
            ctx.moveTo(lastX + bubbleRadius + 4, lastY);
            ctx.lineTo(latestX, latestY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw labels if enough space
            const lineLength = Math.hypot(latestX - (lastX + bubbleRadius + 4), latestY - lastY);
            if (lineLength > 60) {
              const midX = (lastX + bubbleRadius + 4 + latestX) / 2;
              const midY = (lastY + latestY) / 2;
              
              ctx.font = `${timeFontSize}px system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillStyle = COLORS.textMuted;
              ctx.fillText(formatTimeGap(silenceDuration), midX, midY - labelSpacing);
              
              ctx.font = `bold ${pctFontSize}px system-ui, sans-serif`;
              ctx.fillStyle = isNegative ? COLORS.negative : COLORS.positive;
              ctx.fillText(formatPctChange(pctChange), midX, midY + labelSpacing);
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

      // Hover glow
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, scaledRadius + 8, 0, Math.PI * 2);
        ctx.fillStyle = markerGlow;
        ctx.fill();
      }

      // Multiple tweets glow
      if (isMultiple) {
        ctx.beginPath();
        ctx.arc(x, y, scaledRadius + 6, 0, Math.PI * 2);
        ctx.fillStyle = markerMultipleGlow;
        ctx.fill();
      }

      // Border ring
      ctx.beginPath();
      ctx.arc(x, y, scaledRadius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = isHovered ? markerColor : '#FFFFFF';
      ctx.lineWidth = isHovered ? 3 : 2;
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

      // Count badge for multiple tweets
      if (isMultiple && scale > 0.5) {
        const badgeSize = Math.max(14, scaledSize * 0.4);
        const badgeX = x + scaledRadius - badgeSize / 2;
        const badgeY = y - scaledRadius + badgeSize / 3;
        
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeSize / 2 + 2, 0, Math.PI * 2);
        ctx.fillStyle = markerColor;
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
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

  // ---------------------------------------------------------------------------
  // Initialize chart
  // ---------------------------------------------------------------------------
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
        mode: CrosshairMode.Normal,
        vertLine: { color: COLORS.crosshair, width: 1, style: 0, labelBackgroundColor: COLORS.border },
        horzLine: { color: COLORS.crosshair, width: 1, style: 0, labelBackgroundColor: COLORS.border },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        minBarSpacing: 0.5,
      },
      rightPriceScale: {
        borderColor: COLORS.border,
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

    // Resize observer with double-RAF to let chart settle before redrawing markers
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

    // Redraw markers on pan/zoom (X-axis), cancel pending zoom if user interacts
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      pendingZoomRef.current = null;
      drawMarkers();
    });

    // Hover detection with cursor affordance for multi-tweet clusters
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

    // Click handler for clusters - unified behavior for all platforms
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

  // ---------------------------------------------------------------------------
  // Detect available timeframes on asset change
  // ---------------------------------------------------------------------------
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

      console.log(`[Chart] Available timeframes for ${asset.id}:`, [...available]);
      setAvailableTimeframes(available);

      // If current timeframe is not available, switch to 1d
      if (!available.has(timeframe)) {
        console.log(`[Chart] Timeframe ${timeframe} not available, switching to 1d`);
        setTimeframe('1d');
      }
    }
    detectTimeframes();
  }, [asset.id]);

  // ---------------------------------------------------------------------------
  // Load price data
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setDataLoaded(false);
      setNoData(false);

      console.log(`[Chart] Loading ${timeframe} prices for ${asset.id}`);

      try {
        const priceData = await loadPrices(timeframe, asset.id);

        // Handle empty data gracefully
        if (priceData.candles.length === 0) {
          console.warn(`[Chart] No candle data for ${asset.id} @ ${timeframe}`);
          setNoData(true);
          setLoading(false);
          return;
        }

        candlesRef.current = priceData.candles;
        candleTimesRef.current = priceData.candles.map(c => c.t);

        if (seriesRef.current && chartRef.current) {
          // Capture current visible range BEFORE setting new data
          // This allows us to preserve position on manual timeframe switch
          const previousRange = chartRef.current.timeScale().getVisibleRange();

          const chartData = toCandlestickData(priceData);
          console.log(`[Chart] Setting ${chartData.length} candles for ${asset.id} @ ${timeframe}`);
          console.log(`[Chart] First candle:`, chartData[0]);
          console.log(`[Chart] Last candle:`, chartData[chartData.length - 1]);
          seriesRef.current.setData(chartData as CandlestickData<Time>[]);

          if (pendingZoomRef.current) {
            // Cluster click: animate to the pending zoom target
            const { from, to } = pendingZoomRef.current;
            pendingZoomRef.current = null;

            // Use requestAnimationFrame to let chart settle after setData
            requestAnimationFrame(() => {
              if (previousRange && animateToRangeRef.current) {
                // Animate smoothly from previous position to target
                animateToRangeRef.current(from, to);
              } else {
                // No previous position, set directly
                chartRef.current?.timeScale().setVisibleRange({
                  from: from as Time,
                  to: to as Time
                });
              }
            });
          } else if (previousRange) {
            // Manual timeframe switch: preserve center position (TradingView pattern)
            // Use requestAnimationFrame to let chart settle after setData
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
            // Initial load: smart default view
            // Use requestAnimationFrame to let chart settle after setData
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

  // ---------------------------------------------------------------------------
  // Redraw markers when state changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (dataLoaded) {
      const timer = setTimeout(drawMarkers, 50);
      return () => clearTimeout(timer);
    }
  }, [dataLoaded, showBubbles, hoveredTweet, avatarLoaded, drawMarkers]);

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------
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

  const jumpToAllTime = useCallback(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || candles.length === 0) return;

    // For large datasets, set a reasonable max visible range
    // to keep candles visible (about 2000 candles max)
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

  // ---------------------------------------------------------------------------
  // Smooth zoom animation
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Zoom to cluster (for multi-tweet bubbles)
  // Principle: One click = see the detail. Switch to finer timeframe eagerly.
  // ---------------------------------------------------------------------------
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

  // Sync functions to refs (avoid stale closures)
  useEffect(() => {
    zoomToClusterRef.current = zoomToCluster;
  }, [zoomToCluster]);
  
  useEffect(() => {
    animateToRangeRef.current = animateToRange;
  }, [animateToRange]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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
              ? 'bg-[#2A2E39] text-white border border-[#3A3E49]' 
              : 'bg-[#2A2E39] text-[#787B86] hover:text-[#D1D4DC]'
          }`}
        >
          <span>🐦</span>
          <span>Tweet Markers</span>
        </button>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={jumpToLastTweet}
            className="px-2 py-1 text-xs text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#2A2E39] rounded transition-colors"
          >
            Last Tweet
          </button>
          <button
            onClick={jumpToAllTime}
            className="px-2 py-1 text-xs text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#2A2E39] rounded transition-colors"
          >
            All Time
          </button>
        </div>
      </div>

      {/* Timeframe selector - bottom bar on mobile, corner on desktop */}
      <div className="absolute z-20
                     bottom-0 left-0 right-0 
                     md:bottom-2 md:left-2 md:right-auto
                     flex items-center justify-around md:justify-start gap-1
                     bg-[#1E222D] md:bg-transparent 
                     py-3 md:py-0 
                     border-t border-[#2A2E39] md:border-0
                     pb-safe">
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
                    ? 'text-[#787B86] hover:text-[#D1D4DC] md:hover:bg-[#2A2E39]'
                    : 'text-[#3A3E49] cursor-not-allowed'
              }`}
              style={isActive ? { backgroundColor: asset.color } : undefined}
            >
              {tf.label}
            </button>
          );
        })}
      </div>
      
      {/* Help text - desktop only */}
      <span className="hidden md:block absolute bottom-2 left-32 text-[10px] text-[#555] select-none z-20">
        Drag to pan • Scroll to zoom
      </span>
      
      {/* Legend - desktop only */}
      {showBubbles && (
        <div className="absolute bottom-14 md:bottom-2 right-2 z-20 hidden md:flex items-center gap-3 bg-[#1E222D]/90 px-3 py-1.5 rounded text-[10px]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border border-white bg-transparent" />
            <span className="text-[#D1D4DC]">Single tweet</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <div 
                className="w-3 h-3 rounded-full border border-white"
                style={{ backgroundColor: `${asset.color}66` }}
              />
              <span 
                className="absolute -top-0.5 -right-1 text-[7px] text-white font-bold rounded-full w-2.5 h-2.5 flex items-center justify-center"
                style={{ backgroundColor: asset.color }}
              >3</span>
            </div>
            <span className="text-[#D1D4DC]">Multiple tweets</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 border-t border-dashed border-[#EF5350]" />
            <span className="text-[#D1D4DC]">Silence gap</span>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="absolute top-14 right-2 z-20 flex items-center gap-2 bg-[#1E222D] px-3 py-1 rounded">
          <div
            className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: asset.color, borderTopColor: 'transparent' }}
          />
          <span className="text-xs text-[#787B86]">Loading {asset.name}...</span>
        </div>
      )}

      {/* No data message */}
      {noData && !loading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#131722]/80">
          <div className="text-center p-6 bg-[#1E222D] rounded-lg border border-[#2A2E39]">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-[#D1D4DC] font-medium mb-1">No {timeframe} data available</div>
            <div className="text-[#787B86] text-sm mb-3">
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
          className="absolute z-30 pointer-events-none bg-[#1E222D] border border-[#2A2E39] rounded-lg p-3 shadow-xl max-w-xs tooltip-enter"
          style={{
            left: Math.min(tooltipPos.x + 20, containerWidth - 300),
            top: Math.max(tooltipPos.y - 60, 10),
          }}
        >
          <div className="flex items-start gap-2 mb-2">
            <div 
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: asset.color }}
            >
              {asset.founder.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-[#D1D4DC] font-medium text-sm">@{asset.founder}</div>
              <div className="text-[#787B86] text-xs">
                {new Date(hoveredTweet.timestamp * 1000).toLocaleString()}
              </div>
            </div>
          </div>
          <p className="text-sm text-[#D1D4DC] line-clamp-3 mb-2">{hoveredTweet.text}</p>
          <div className="flex items-center gap-4 text-xs text-[#787B86]">
            <span>❤️ {hoveredTweet.likes.toLocaleString()}</span>
            <span>🔁 {hoveredTweet.retweets.toLocaleString()}</span>
          </div>
          {hoveredTweet.change_1h_pct !== null && (
            <div className="mt-2 pt-2 border-t border-[#2A2E39] flex items-center gap-3 text-xs">
              <span className="text-[#787B86]">Price impact:</span>
              <span className={hoveredTweet.change_1h_pct >= 0 ? 'text-[#26A69A]' : 'text-[#EF5350]'}>
                1h: {hoveredTweet.change_1h_pct >= 0 ? '+' : ''}{hoveredTweet.change_1h_pct.toFixed(1)}%
              </span>
              {hoveredTweet.change_24h_pct !== null && (
                <span className={hoveredTweet.change_24h_pct >= 0 ? 'text-[#26A69A]' : 'text-[#EF5350]'}>
                  24h: {hoveredTweet.change_24h_pct >= 0 ? '+' : ''}{hoveredTweet.change_24h_pct.toFixed(1)}%
                </span>
              )}
            </div>
          )}
          <div className="mt-2 text-xs" style={{ color: asset.color }}>Tap to dismiss</div>
        </div>
      )}
    </div>
  );
}
