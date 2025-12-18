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
import { Timeframe, TweetEvent, Candle, TweetCluster } from '@/lib/types';
import { loadPrices, toCandlestickData } from '@/lib/dataLoader';

// Twitter blue color
const TWITTER_BLUE = '#1DA1F2';
const MARKER_OFFSET = 20; // pixels above candle high

interface ChartProps {
  tweetEvents: TweetEvent[];
}

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1m', value: '1m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '1D', value: '1d' },
];

// Timeframe durations in seconds
const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '1d': 24 * 60 * 60,
};

export default function Chart({ tweetEvents }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Default to 1D to show full history
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [loading, setLoading] = useState(true);
  const [showBubbles, setShowBubbles] = useState(true);
  const [hoveredCluster, setHoveredCluster] = useState<TweetCluster | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [dataLoaded, setDataLoaded] = useState(false);
  
  // Store latest values in refs to avoid stale closures
  const tweetEventsRef = useRef(tweetEvents);
  const showBubblesRef = useRef(showBubbles);
  const hoveredClusterRef = useRef(hoveredCluster);
  const candleTimesRef = useRef<number[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const clustersRef = useRef<TweetCluster[]>([]);
  const timeframeRef = useRef<Timeframe>(timeframe);
  
  // Keep refs in sync
  useEffect(() => { tweetEventsRef.current = tweetEvents; }, [tweetEvents]);
  useEffect(() => { showBubblesRef.current = showBubbles; }, [showBubbles]);
  useEffect(() => { hoveredClusterRef.current = hoveredCluster; }, [hoveredCluster]);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);
  
  // Avatar
  const avatarRef = useRef<HTMLImageElement | null>(null);
  const [avatarLoaded, setAvatarLoaded] = useState(false);

  // Load avatar
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/avatars/a1lon9.png';
    img.onload = () => {
      avatarRef.current = img;
      setAvatarLoaded(true);
    };
    img.onerror = () => {
      console.error('Failed to load avatar');
      setAvatarLoaded(true);
    };
  }, []);

  /**
   * Cluster tweets by timeframe window
   * Each candle period groups all tweets within it
   */
  const clusterTweetsByTimeframe = useCallback((
    tweets: TweetEvent[],
    candles: Candle[],
    tf: Timeframe
  ): TweetCluster[] => {
    if (candles.length === 0 || tweets.length === 0) return [];
    
    const windowSeconds = TIMEFRAME_SECONDS[tf];
    const clusters: TweetCluster[] = [];
    
    // Create a map of candle start time -> candle
    const candleMap = new Map<number, Candle>();
    for (const candle of candles) {
      candleMap.set(candle.t, candle);
    }
    
    // Group tweets by their candle window
    const tweetsByWindow = new Map<number, TweetEvent[]>();
    
    for (const tweet of tweets) {
      if (tweet.price_at_tweet === null) continue;
      
      // Find which candle window this tweet falls into
      const windowStart = Math.floor(tweet.timestamp / windowSeconds) * windowSeconds;
      
      if (!tweetsByWindow.has(windowStart)) {
        tweetsByWindow.set(windowStart, []);
      }
      tweetsByWindow.get(windowStart)!.push(tweet);
    }
    
    // Convert to clusters
    const sortedWindows = Array.from(tweetsByWindow.keys()).sort((a, b) => a - b);
    
    for (let i = 0; i < sortedWindows.length; i++) {
      const windowStart = sortedWindows[i];
      const windowTweets = tweetsByWindow.get(windowStart)!;
      
      // Find the candle for this window (or closest one)
      let candle = candleMap.get(windowStart);
      if (!candle) {
        // Find closest candle
        let minDiff = Infinity;
        for (const c of candles) {
          const diff = Math.abs(c.t - windowStart);
          if (diff < minDiff) {
            minDiff = diff;
            candle = c;
          }
        }
      }
      
      if (!candle) continue;
      
      // Calculate period change (open to close of the candle)
      const periodChange = candle.o !== 0 ? ((candle.c - candle.o) / candle.o) * 100 : 0;
      
      // Calculate gap to next cluster
      const nextWindowStart = sortedWindows[i + 1];
      const gapToNext = nextWindowStart ? nextWindowStart - windowStart : null;
      
      // Calculate price change during gap (from this candle's close to next cluster's candle open)
      let gapChange: number | null = null;
      if (nextWindowStart) {
        const nextCandle = candleMap.get(nextWindowStart);
        if (nextCandle && candle.c !== 0) {
          gapChange = ((nextCandle.o - candle.c) / candle.c) * 100;
        }
      }
      
      clusters.push({
        startTime: windowStart,
        endTime: windowStart + windowSeconds,
        tweets: windowTweets,
        count: windowTweets.length,
        candleHigh: candle.h,
        candleLow: candle.l,
        periodChange,
        gapToNext,
        gapChange,
      });
    }
    
    return clusters;
  }, []);

  /**
   * Format duration in human readable form
   */
  const formatDuration = useCallback((seconds: number): string => {
    if (!seconds || !isFinite(seconds)) return '';
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return '<1m';
  }, []);

  /**
   * Draw tweet markers (clusters or individual bubbles)
   */
  const drawMarkers = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = markersCanvasRef.current;
    const container = containerRef.current;
    const clusters = clustersRef.current;
    const showTweets = showBubblesRef.current;
    const hovered = hoveredClusterRef.current;
    const avatar = avatarRef.current;

    if (!canvas || !container) return;

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

    if (!chart || !series || !showTweets || clusters.length === 0) return;

    let visibleRange;
    try {
      visibleRange = chart.timeScale().getVisibleRange();
    } catch {
      return;
    }
    if (!visibleRange) return;

    const rangeFrom = visibleRange.from as number;
    const rangeTo = visibleRange.to as number;
    
    if (!isFinite(rangeFrom) || !isFinite(rangeTo)) return;

    // Filter to visible clusters
    const visibleClusters = clusters.filter(cluster => 
      cluster.startTime >= rangeFrom && cluster.startTime <= rangeTo
    );

    // Draw gap lines first (behind markers)
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    for (let i = 0; i < visibleClusters.length - 1; i++) {
      const current = visibleClusters[i];
      const next = visibleClusters[i + 1];
      
      const x1 = chart.timeScale().timeToCoordinate(current.startTime as Time);
      const y1 = series.priceToCoordinate(current.candleHigh);
      const x2 = chart.timeScale().timeToCoordinate(next.startTime as Time);
      const y2 = series.priceToCoordinate(next.candleHigh);
      
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
      
      // Adjust y positions to be above the candle
      const y1Adj = y1 - MARKER_OFFSET;
      const y2Adj = y2 - MARKER_OFFSET;
      
      // Draw connecting line
      const gapChange = current.gapChange ?? 0;
      ctx.strokeStyle = gapChange >= 0 ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x1, y1Adj);
      ctx.lineTo(x2, y2Adj);
      ctx.stroke();
      
      // Draw gap label at midpoint (only if there's enough space)
      const midX = (x1 + x2) / 2;
      const midY = (y1Adj + y2Adj) / 2 - 10;
      const gapDuration = current.gapToNext ?? 0;
      
      if (Math.abs(x2 - x1) > 60 && gapDuration > 0) {
        const durationStr = formatDuration(gapDuration);
        const changeStr = `${gapChange >= 0 ? '+' : ''}${gapChange.toFixed(1)}%`;
        
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#787B86';
        ctx.fillText(`${durationStr}`, midX, midY);
        ctx.fillStyle = gapChange >= 0 ? '#26A69A' : '#EF5350';
        ctx.fillText(changeStr, midX, midY + 12);
      }
    }
    
    ctx.setLineDash([]);
    
    // Draw markers
    for (const cluster of visibleClusters) {
      const x = chart.timeScale().timeToCoordinate(cluster.startTime as Time);
      const y = series.priceToCoordinate(cluster.candleHigh);
      
      if (x === null || y === null) continue;
      
      // Position marker above the candle high
      const yPos = y - MARKER_OFFSET;
      
      const isHovered = hovered?.startTime === cluster.startTime;
      
      if (cluster.count === 1) {
        // Single tweet: Draw avatar bubble
        const BUBBLE_SIZE = 24;
        const BUBBLE_RADIUS = BUBBLE_SIZE / 2;
        
        // Hover highlight
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(x, yPos, BUBBLE_RADIUS + 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(29, 161, 242, 0.3)';
          ctx.fill();
        }
        
        // Border
        ctx.beginPath();
        ctx.arc(x, yPos, BUBBLE_RADIUS + 2, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? TWITTER_BLUE : '#FFFFFF';
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.stroke();
        
        // Avatar or fallback
        if (avatar) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, yPos, BUBBLE_RADIUS, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatar, x - BUBBLE_RADIUS, y - MARKER_OFFSET - BUBBLE_RADIUS, BUBBLE_SIZE, BUBBLE_SIZE);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, yPos, BUBBLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = TWITTER_BLUE;
          ctx.fill();
        }
      } else {
        // Multiple tweets: Draw badge with count
        const BADGE_SIZE = 28;
        const BADGE_RADIUS = BADGE_SIZE / 2;
        
        // Hover highlight
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(x, yPos, BADGE_RADIUS + 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(29, 161, 242, 0.3)';
          ctx.fill();
        }
        
        // Badge background - intensity based on count
        const intensity = Math.min(1, 0.4 + (cluster.count / 10) * 0.6);
        ctx.beginPath();
        ctx.arc(x, yPos, BADGE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(29, 161, 242, ${intensity})`;
        ctx.fill();
        
        // Border
        ctx.beginPath();
        ctx.arc(x, yPos, BADGE_RADIUS + 1, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? '#FFFFFF' : TWITTER_BLUE;
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.stroke();
        
        // Count text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cluster.count.toString(), x, yPos);
      }
    }
    
    // Draw current silence gap indicator
    if (clusters.length > 0) {
      const lastCluster = clusters[clusters.length - 1];
      const now = Math.floor(Date.now() / 1000);
      const silenceDuration = now - lastCluster.endTime;
      
      // Only show if significant silence (>24h)
      if (silenceDuration > 24 * 60 * 60) {
        const lastX = chart.timeScale().timeToCoordinate(lastCluster.startTime as Time);
        const nowX = chart.timeScale().timeToCoordinate(now as Time);
        const lastY = series.priceToCoordinate(lastCluster.candleHigh);
        
        if (lastX !== null && nowX !== null && lastY !== null) {
          // Find current price for gap change
          const candles = candlesRef.current;
          const currentPrice = candles.length > 0 ? candles[candles.length - 1].c : null;
          const lastTweet = lastCluster.tweets[lastCluster.tweets.length - 1];
          const silenceChange = currentPrice && lastTweet.price_at_tweet 
            ? ((currentPrice - lastTweet.price_at_tweet) / lastTweet.price_at_tweet) * 100 
            : null;
          
          // Draw silence line
          ctx.strokeStyle = 'rgba(239, 83, 80, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(lastX, lastY - MARKER_OFFSET);
          ctx.lineTo(nowX, lastY - MARKER_OFFSET);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Draw "now" marker
          const midX = (lastX + nowX) / 2;
          const yPos = lastY - MARKER_OFFSET - 20;
          
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#EF5350';
          
          const days = Math.floor(silenceDuration / (24 * 60 * 60));
          ctx.fillText(`${days} days silent`, midX, yPos);
          
          if (silenceChange !== null) {
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText(`${silenceChange >= 0 ? '+' : ''}${silenceChange.toFixed(1)}%`, midX, yPos + 14);
          }
        }
      }
    }
  }, [formatDuration]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const chart = createChart(container, {
      width: width || 800,
      height: height || 500,
      layout: {
        background: { color: '#131722' },
        textColor: '#D1D4DC',
      },
      grid: {
        vertLines: { color: '#1E222D' },
        horzLines: { color: '#1E222D' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#758696', width: 1, style: 0, labelBackgroundColor: '#2A2E39' },
        horzLine: { color: '#758696', width: 1, style: 0, labelBackgroundColor: '#2A2E39' },
      },
      timeScale: {
        borderColor: '#2A2E39',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        minBarSpacing: 0.5,
      },
      rightPriceScale: {
        borderColor: '#2A2E39',
        scaleMargins: { top: 0.15, bottom: 0.2 },
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
      upColor: '#26A69A',
      downColor: '#EF5350',
      borderUpColor: '#26A69A',
      borderDownColor: '#EF5350',
      wickUpColor: '#26A69A',
      wickDownColor: '#EF5350',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
        drawMarkers();
      }
    });
    resizeObserver.observe(container);

    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      drawMarkers();
    });

    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param.point) {
        setHoveredCluster(null);
        return;
      }

      const { x, y } = param.point;
      const HOVER_RADIUS = 28;
      const clusters = clustersRef.current;

      let found: TweetCluster | null = null;
      let foundX = 0, foundY = 0;

      for (const cluster of clusters) {
        const tx = chart.timeScale().timeToCoordinate(cluster.startTime as Time);
        const ty = series.priceToCoordinate(cluster.candleHigh);

        if (tx === null || ty === null) continue;
        
        // Adjust for marker offset
        const tyAdj = ty - MARKER_OFFSET;

        const dist = Math.hypot(tx - x, tyAdj - y);
        if (dist < HOVER_RADIUS) {
          found = cluster;
          foundX = tx;
          foundY = tyAdj;
          break;
        }
      }

      if (found) {
        setHoveredCluster(found);
        setTooltipPos({ x: foundX, y: foundY });
      } else {
        setHoveredCluster(null);
      }
    });

    chart.subscribeClick((param: MouseEventParams) => {
      if (!param.point) return;

      const { x, y } = param.point;
      const CLICK_RADIUS = 28;
      const clusters = clustersRef.current;

      for (const cluster of clusters) {
        const tx = chart.timeScale().timeToCoordinate(cluster.startTime as Time);
        const ty = series.priceToCoordinate(cluster.candleHigh);

        if (tx === null || ty === null) continue;
        
        // Adjust for marker offset
        const tyAdj = ty - MARKER_OFFSET;

        const dist = Math.hypot(tx - x, tyAdj - y);
        if (dist < CLICK_RADIUS) {
          // If single tweet, open it; otherwise open first tweet
          const tweet = cluster.tweets[0];
          if (tweet) {
            window.open(`https://twitter.com/a1lon9/status/${tweet.tweet_id}`, '_blank');
          }
          break;
        }
      }
    });

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [drawMarkers]);

  // Load data when timeframe changes
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setDataLoaded(false);
      
      try {
        const priceData = await loadPrices(timeframe);
        
        candlesRef.current = priceData.candles;
        candleTimesRef.current = priceData.candles.map(c => c.t);
        
        // Cluster tweets by current timeframe
        const clusters = clusterTweetsByTimeframe(tweetEvents, priceData.candles, timeframe);
        clustersRef.current = clusters;
        
        if (seriesRef.current && chartRef.current) {
          const chartData = toCandlestickData(priceData);
          seriesRef.current.setData(chartData as CandlestickData<Time>[]);
          
          // Set visible range with validation
          try {
            const tweetsWithPrice = tweetEvents.filter(t => t.price_at_tweet !== null);
            if (tweetsWithPrice.length > 0 && priceData.candles.length > 0) {
              const firstTweetTime = tweetsWithPrice[0].timestamp;
              const lastDataTime = priceData.end;
              
              // Validate the range values
              if (firstTweetTime && lastDataTime && firstTweetTime < lastDataTime) {
                chartRef.current.timeScale().setVisibleRange({
                  from: firstTweetTime as Time,
                  to: lastDataTime as Time,
                });
              } else {
                chartRef.current.timeScale().fitContent();
              }
            } else {
              chartRef.current.timeScale().fitContent();
            }
          } catch (rangeError) {
            console.warn('Failed to set visible range, using fitContent:', rangeError);
            chartRef.current.timeScale().fitContent();
          }
          
          setDataLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load price data:', error);
      }
      setLoading(false);
    }
    loadData();
  }, [timeframe, tweetEvents, clusterTweetsByTimeframe]);

  // Redraw when state changes
  useEffect(() => {
    if (dataLoaded) {
      const timer = setTimeout(() => {
        drawMarkers();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [dataLoaded, showBubbles, hoveredCluster, avatarLoaded, drawMarkers]);

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

  return (
    <div className="relative w-full h-full bg-[#131722]">
      <div ref={containerRef} className="absolute inset-0" />
      
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
              ? 'bg-[#1DA1F2] text-white' 
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
      
      {/* Legend (top right) */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-3 bg-[#1E222D]/90 px-3 py-2 rounded-lg text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-[#1DA1F2]"></div>
          <span className="text-[#B0B0B0]">Single tweet</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-[#1DA1F2] flex items-center justify-center text-[10px] text-white font-bold">3</div>
          <span className="text-[#B0B0B0]">Multiple tweets</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-[#EF5350] opacity-60" style={{ borderStyle: 'dashed' }}></div>
          <span className="text-[#B0B0B0]">Silence gap</span>
        </div>
      </div>

      {/* Timeframe selector */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 z-20">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              timeframe === tf.value
                ? 'bg-[#1DA1F2] text-white'
                : 'text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#2A2E39]'
            }`}
          >
            {tf.label}
          </button>
        ))}
        <span className="ml-3 text-[10px] text-[#555] select-none">
          Drag to pan • Scroll to zoom
        </span>
      </div>
      
      {/* Timeframe hint */}
      <div className="absolute bottom-2 right-2 z-20 bg-[#1E222D]/90 px-3 py-1.5 rounded text-[10px] text-[#787B86]">
        {timeframe === '1d' && 'Tweets grouped by day'}
        {timeframe === '1h' && 'Tweets grouped by hour'}
        {timeframe === '15m' && 'Tweets grouped by 15 minutes'}
        {timeframe === '1m' && 'Individual tweets'}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="absolute top-14 right-2 z-20 flex items-center gap-2 bg-[#1E222D] px-3 py-1 rounded">
          <div className="w-3 h-3 border-2 border-[#1DA1F2] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#787B86]">Loading...</span>
        </div>
      )}

      {/* Cluster/Tweet tooltip */}
      {hoveredCluster && (
        <div
          className="absolute z-30 pointer-events-none bg-[#1E222D] border border-[#2A2E39] rounded-lg p-3 shadow-xl max-w-xs"
          style={{
            left: Math.min(tooltipPos.x + 20, (containerRef.current?.clientWidth || 400) - 300),
            top: Math.max(tooltipPos.y - 80, 10),
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <img src="/avatars/a1lon9.png" alt="Alon" className="w-6 h-6 rounded-full" />
              <span className="text-[#D1D4DC] font-medium text-sm">@a1lon9</span>
            </div>
            {hoveredCluster.count > 1 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#1DA1F2] text-white">
                {hoveredCluster.count} tweets
              </span>
            )}
          </div>
          
          {/* Date */}
          <div className="text-[#787B86] text-xs mb-2">
            {new Date(hoveredCluster.startTime * 1000).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {timeframe !== '1d' && (
              <span className="ml-1">
                {new Date(hoveredCluster.startTime * 1000).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
          
          {/* Tweet preview(s) */}
          <div className="space-y-2 mb-2">
            {hoveredCluster.tweets.slice(0, 2).map((tweet, i) => (
              <p key={i} className="text-sm text-[#D1D4DC] line-clamp-2">
                {tweet.text}
              </p>
            ))}
            {hoveredCluster.tweets.length > 2 && (
              <p className="text-xs text-[#787B86]">
                +{hoveredCluster.tweets.length - 2} more tweets...
              </p>
            )}
          </div>
          
          {/* Period stats */}
          <div className="border-t border-[#2A2E39] pt-2 mt-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-[#787B86]">Period:</span>
              <span className={hoveredCluster.periodChange >= 0 ? 'text-[#26A69A]' : 'text-[#EF5350]'}>
                {hoveredCluster.periodChange >= 0 ? '+' : ''}{hoveredCluster.periodChange.toFixed(1)}%
              </span>
              {hoveredCluster.gapToNext && hoveredCluster.gapChange !== null && (
                <>
                  <span className="text-[#787B86]">→ Next:</span>
                  <span className={hoveredCluster.gapChange >= 0 ? 'text-[#26A69A]' : 'text-[#EF5350]'}>
                    {hoveredCluster.gapChange >= 0 ? '+' : ''}{hoveredCluster.gapChange.toFixed(1)}%
                  </span>
                </>
              )}
            </div>
          </div>
          
          {/* Engagement */}
          <div className="flex items-center gap-4 text-xs text-[#787B86] mt-2">
            <span>❤️ {hoveredCluster.tweets.reduce((sum, t) => sum + t.likes, 0).toLocaleString()}</span>
            <span>🔁 {hoveredCluster.tweets.reduce((sum, t) => sum + t.retweets, 0).toLocaleString()}</span>
          </div>
          
          <div className="mt-2 text-xs text-[#1DA1F2]">Click to view tweet →</div>
        </div>
      )}
    </div>
  );
}
