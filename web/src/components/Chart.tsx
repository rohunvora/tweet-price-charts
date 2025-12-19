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

/** Chart theme colors (TradingView dark theme inspired) */
const COLORS = {
  background: '#131722',
  text: '#D1D4DC',
  textMuted: '#787B86',
  gridLines: '#1E222D',
  border: '#2A2E39',
  crosshair: '#758696',
  // Candlestick colors (muted to not compete with markers)
  candleUp: 'rgba(38, 166, 154, 0.3)',
  candleDown: 'rgba(239, 83, 80, 0.3)',
  candleBorderUp: 'rgba(38, 166, 154, 0.4)',
  candleBorderDown: 'rgba(239, 83, 80, 0.4)',
  // Marker colors
  markerPrimary: '#2962FF',
  markerHoverGlow: 'rgba(41, 98, 255, 0.3)',
  markerMultipleGlow: 'rgba(41, 98, 255, 0.4)',
  // Price change colors
  positive: '#26A69A',
  negative: '#EF5350',
} as const;

/** Minimum time gap (in seconds) between clusters to show silence line */
const SILENCE_GAP_THRESHOLD = 24 * 3600; // 24 hours

/** Available timeframe options */
const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1m', value: '1m' },
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
  x: number;
  y: number;
  avgPrice: number;
  avgTimestamp: number;
  avgChange: number | null;
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
  // Draw markers (clustering + gap annotations)
  // ---------------------------------------------------------------------------
  const drawMarkers = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = markersCanvasRef.current;
    const container = containerRef.current;
    const tweets = tweetEventsRef.current;
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
    const clusterThreshold = bubbleSize + 8;  // Pixels apart to trigger clustering

    // Filter to visible tweets with price data
    const visibleTweets = tweets
      .filter(t => t.price_at_tweet && t.timestamp >= rangeFrom && t.timestamp <= rangeTo)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (visibleTweets.length === 0) return;

    // -------------------------------------------------------------------------
    // Helper: emit a cluster from accumulated tweets
    // -------------------------------------------------------------------------
    function emitCluster(
      tweets: TweetEvent[],
      x: number,
      seriesApi: ISeriesApi<'Candlestick'>,
      clusterArray: TweetClusterDisplay[]
    ) {
      const avgPrice = tweets.reduce((sum, t) => sum + (t.price_at_tweet || 0), 0) / tweets.length;
      const avgTimestamp = tweets.reduce((sum, t) => sum + t.timestamp, 0) / tweets.length;
      const changes = tweets.filter(t => t.change_24h_pct !== null).map(t => t.change_24h_pct!);
      const avgChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
      const y = seriesApi.priceToCoordinate(avgPrice);
      
      if (y !== null) {
        clusterArray.push({
          tweets: [...tweets],
          x,
          y,
          avgPrice,
          avgTimestamp,
          avgChange,
          timeSincePrev: null,
          pctSincePrev: null,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Build clusters from overlapping markers
    // -------------------------------------------------------------------------
    const clusters: TweetClusterDisplay[] = [];
    let currentCluster: TweetEvent[] = [];
    let clusterX: number | null = null;

    for (const tweet of visibleTweets) {
      const nearestTime = findNearestCandleTime(tweet.timestamp);
      const x = nearestTime ? chart.timeScale().timeToCoordinate(nearestTime as Time) : null;
      if (x === null) continue;

      if (currentCluster.length === 0) {
        currentCluster.push(tweet);
        clusterX = x;
      } else if (clusterX !== null && Math.abs(x - clusterX) < clusterThreshold) {
        currentCluster.push(tweet);
        clusterX = (clusterX * (currentCluster.length - 1) + x) / currentCluster.length;
      } else {
        // Emit completed cluster
        emitCluster(currentCluster, clusterX!, series, clusters);
        currentCluster = [tweet];
        clusterX = x;
      }
    }
    // Emit final cluster
    if (currentCluster.length > 0 && clusterX !== null) {
      emitCluster(currentCluster, clusterX, series, clusters);
    }

    // Calculate time gaps and price changes between clusters
    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1];
      const curr = clusters[i];
      curr.timeSincePrev = curr.avgTimestamp - prev.avgTimestamp;
      if (prev.avgPrice > 0) {
        curr.pctSincePrev = ((curr.avgPrice - prev.avgPrice) / prev.avgPrice) * 100;
      }
    }

    // -------------------------------------------------------------------------
    // Draw silence gap lines between clusters
    // -------------------------------------------------------------------------
    const timeFontSize = Math.round(8 + 4 * zoomFactor);
    const pctFontSize = Math.round(9 + 4 * zoomFactor);
    const labelSpacing = Math.round(6 + 4 * zoomFactor);
    
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    
    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1];
      const curr = clusters[i];
      
      if (curr.timeSincePrev && curr.timeSincePrev > SILENCE_GAP_THRESHOLD) {
        const isNegative = curr.pctSincePrev !== null && curr.pctSincePrev < 0;
        ctx.strokeStyle = isNegative ? 'rgba(239, 83, 80, 0.5)' : 'rgba(38, 166, 154, 0.5)';
        
        const startX = prev.x + bubbleRadius + 4;
        const endX = curr.x - bubbleRadius - 4;
        const midX = (startX + endX) / 2;
        const midY = (prev.y + curr.y) / 2;
        
        // Draw dashed line
        ctx.beginPath();
        ctx.moveTo(startX, prev.y);
        ctx.lineTo(endX, curr.y);
        ctx.stroke();
        
        // Draw labels at midpoint
        ctx.setLineDash([]);
        
        if (curr.timeSincePrev > 3600) {
          ctx.font = `${timeFontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = COLORS.textMuted;
          ctx.fillText(formatTimeGap(curr.timeSincePrev), midX, midY - labelSpacing);
        }
        
        if (curr.pctSincePrev !== null) {
          ctx.font = `bold ${pctFontSize}px system-ui, sans-serif`;
          ctx.fillStyle = curr.pctSincePrev >= 0 ? COLORS.positive : COLORS.negative;
          ctx.fillText(formatPctChange(curr.pctSincePrev), midX, midY + labelSpacing);
        }
        
        ctx.setLineDash([6, 4]);
      }
    }
    ctx.setLineDash([]);

    // -------------------------------------------------------------------------
    // Draw cluster markers with entrance animation
    // -------------------------------------------------------------------------
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const { x, y, tweets: clusterTweets } = cluster;
      const count = clusterTweets.length;
      const isMultiple = count > 1;
      const isHovered = clusterTweets.some(t => hovered?.tweet_id === t.tweet_id);

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
        scaleMargins: { top: 0.1, bottom: 0.2 },
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

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
        setContainerWidth(width);
        drawMarkers();
      }
    });
    resizeObserver.observe(container);

    // Redraw markers on pan/zoom, cancel pending zoom if user interacts
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

    // Click handler for clusters
    chart.subscribeClick((param: MouseEventParams) => {
      if (!param.point) return;

      const { x, y } = param.point;
      const CLICK_RADIUS = 24;

      for (const cluster of clustersRef.current) {
        if (Math.hypot(cluster.x - x, cluster.y - y) < CLICK_RADIUS) {
          if (cluster.tweets.length > 1) {
            // Multi-tweet cluster: zoom in
            zoomToClusterRef.current?.(cluster);
          }
          // Single tweet: do nothing (hover tooltip is sufficient)
          return;
        }
      }
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
          seriesRef.current.setData(toCandlestickData(priceData) as CandlestickData<Time>[]);

          // Official best practice: fitContent() auto-scales both axes
          // This resets X-axis to show all data and triggers Y-axis auto-scale
          chartRef.current.timeScale().fitContent();

          setDataLoaded(true);
          
          // Trigger bubble entrance animation
          bubbleAnimRef.current = { start: performance.now(), active: true };
          
          // Apply pending zoom if set (from cluster click)
          if (pendingZoomRef.current) {
            const { from, to } = pendingZoomRef.current;
            pendingZoomRef.current = null;
            setTimeout(() => animateToRangeRef.current?.(from, to), 50);
          }
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
    chartRef.current?.timeScale().fitContent();
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
  // ---------------------------------------------------------------------------
  const zoomToCluster = useCallback((cluster: TweetClusterDisplay) => {
    const ts = cluster.tweets.map(t => t.timestamp);
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    const span = Math.max(max - min, 3600); // min 1h span
    const from = min - span * 0.5;
    const to = max + span * 0.5;
    
    // Pick timeframe: <2h→1m, <24h→15m, <7d→1h
    const targetTF: Timeframe = 
      (to - from) < 7200 && availableTimeframes.has('1m') ? '1m' :
      (to - from) < 86400 && availableTimeframes.has('15m') ? '15m' :
      (to - from) < 604800 && availableTimeframes.has('1h') ? '1h' : 
      timeframe;
    
    if (targetTF !== timeframe) {
      pendingZoomRef.current = { from, to };
      setTimeframe(targetTF);
    } else {
      animateToRange(from, to);
    }
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

      {/* Top controls */}
      <div className="absolute top-2 left-2 z-20 flex items-center gap-2">
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

      {/* Timeframe selector */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 z-20">
        {TIMEFRAMES.map((tf) => {
          const isAvailable = availableTimeframes.has(tf.value);
          const isActive = timeframe === tf.value;
          return (
            <button
              key={tf.value}
              onClick={() => isAvailable && setTimeframe(tf.value)}
              disabled={!isAvailable}
              title={!isAvailable ? `${tf.label} data not available for ${asset.name}` : undefined}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                isActive
                  ? 'text-white'
                  : isAvailable
                    ? 'text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#2A2E39] asset-accent'
                    : 'text-[#3A3E49] cursor-not-allowed'
              }`}
              style={isActive ? { backgroundColor: asset.color } : undefined}
            >
              {tf.label}
            </button>
          );
        })}
        <span className="ml-3 text-[10px] text-[#555] select-none">
          Drag to pan • Scroll to zoom
        </span>
      </div>
      
      {/* Legend */}
      {showBubbles && (
        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-3 bg-[#1E222D]/90 px-3 py-1.5 rounded text-[10px]">
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
          <div className="mt-2 text-xs" style={{ color: asset.color }}>Click bubble to view tweet →</div>
        </div>
      )}
    </div>
  );
}
