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
import { Timeframe, TweetEvent, Candle } from '@/lib/types';
import { 
  loadPrices, 
  toCandlestickData, 
  getSortedTweetTimestamps,
} from '@/lib/dataLoader';
import { 
  formatTimeGap,
  formatPctChange,
} from '@/lib/heatCalculator';

interface ChartProps {
  tweetEvents: TweetEvent[];
}

// Cluster for grouped tweets
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

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1m', value: '1m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '1D', value: '1d' },
];

export default function Chart({ tweetEvents }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Default to 1D to show full history
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [loading, setLoading] = useState(true);
  const [showBubbles, setShowBubbles] = useState(true);
  const [hoveredTweet, setHoveredTweet] = useState<TweetEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [dataLoaded, setDataLoaded] = useState(false);
  
  // Store latest values in refs to avoid stale closures
  const tweetEventsRef = useRef(tweetEvents);
  const showBubblesRef = useRef(showBubbles);
  const hoveredTweetRef = useRef(hoveredTweet);
  const candleTimesRef = useRef<number[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const sortedTweetTimestampsRef = useRef<number[]>([]);
  
  // Keep refs in sync
  useEffect(() => { tweetEventsRef.current = tweetEvents; }, [tweetEvents]);
  useEffect(() => { showBubblesRef.current = showBubbles; }, [showBubbles]);
  useEffect(() => { hoveredTweetRef.current = hoveredTweet; }, [hoveredTweet]);
  
  // Compute sorted tweet timestamps
  useEffect(() => {
    sortedTweetTimestampsRef.current = getSortedTweetTimestamps(tweetEvents);
  }, [tweetEvents]);
  
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

  // Draw tweet markers with smart clustering and annotations
  const drawMarkers = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = markersCanvasRef.current;
    const container = containerRef.current;
    const tweets = tweetEventsRef.current;
    const showTweets = showBubblesRef.current;
    const hovered = hoveredTweetRef.current;
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

    if (!chart || !series || !showTweets) return;

    const visibleRange = chart.timeScale().getVisibleRange();
    if (!visibleRange) return;
    
    const rangeFrom = visibleRange.from as number;
    const rangeTo = visibleRange.to as number;
    const visibleSeconds = rangeTo - rangeFrom;
    
    // Adaptive sizing based on zoom level
    // More zoomed out = smaller markers and more aggressive clustering
    const zoomFactor = Math.min(1, Math.max(0.4, 86400 * 7 / visibleSeconds)); // 7 days = 1.0
    const BUBBLE_SIZE = Math.round(24 + 16 * zoomFactor); // 24-40px
    const BUBBLE_RADIUS = BUBBLE_SIZE / 2;
    const CLUSTER_THRESHOLD = BUBBLE_SIZE + 8; // Pixels apart to cluster

    // Filter visible tweets
    const visibleTweets = tweets.filter(tweet => {
      if (!tweet.price_at_tweet) return false;
      return tweet.timestamp >= rangeFrom && tweet.timestamp <= rangeTo;
    }).sort((a, b) => a.timestamp - b.timestamp);

    if (visibleTweets.length === 0) return;

    // Calculate positions and cluster nearby markers
    const clusters: TweetClusterDisplay[] = [];
    let currentCluster: TweetEvent[] = [];
    let clusterX: number | null = null;

    for (let i = 0; i < visibleTweets.length; i++) {
      const tweet = visibleTweets[i];
      const nearestTime = findNearestCandleTime(tweet.timestamp);
      const x = nearestTime ? chart.timeScale().timeToCoordinate(nearestTime as Time) : null;
      
      if (x === null) continue;

      if (currentCluster.length === 0) {
        currentCluster.push(tweet);
        clusterX = x;
      } else if (clusterX !== null && Math.abs(x - clusterX) < CLUSTER_THRESHOLD) {
        currentCluster.push(tweet);
        // Update cluster X to be average
        clusterX = (clusterX * (currentCluster.length - 1) + x) / currentCluster.length;
      } else {
        // Emit current cluster
        if (currentCluster.length > 0) {
          const avgPrice = currentCluster.reduce((sum, t) => sum + (t.price_at_tweet || 0), 0) / currentCluster.length;
          const avgTimestamp = currentCluster.reduce((sum, t) => sum + t.timestamp, 0) / currentCluster.length;
          const changes = currentCluster.filter(t => t.change_24h_pct !== null).map(t => t.change_24h_pct!);
          const avgChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
          const y = series.priceToCoordinate(avgPrice);
          
          if (y !== null && clusterX !== null) {
            clusters.push({
              tweets: [...currentCluster],
              x: clusterX,
              y,
              avgPrice,
              avgTimestamp,
              avgChange,
              timeSincePrev: null,
              pctSincePrev: null,
            });
          }
        }
        currentCluster = [tweet];
        clusterX = x;
      }
    }

    // Emit final cluster
    if (currentCluster.length > 0 && clusterX !== null) {
      const avgPrice = currentCluster.reduce((sum, t) => sum + (t.price_at_tweet || 0), 0) / currentCluster.length;
      const avgTimestamp = currentCluster.reduce((sum, t) => sum + t.timestamp, 0) / currentCluster.length;
      const changes = currentCluster.filter(t => t.change_24h_pct !== null).map(t => t.change_24h_pct!);
      const avgChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
      const y = series.priceToCoordinate(avgPrice);
      
      if (y !== null) {
        clusters.push({
          tweets: [...currentCluster],
          x: clusterX,
          y,
          avgPrice,
          avgTimestamp,
          avgChange,
          timeSincePrev: null,
          pctSincePrev: null,
        });
      }
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

    // Draw silence gap lines between clusters with labels at midpoint
    const GAP_THRESHOLD = 24 * 3600; // 24 hours minimum to show gap line
    
    // Adaptive font sizing based on zoom level
    const timeFontSize = Math.round(8 + 4 * zoomFactor); // 8-12px
    const pctFontSize = Math.round(9 + 4 * zoomFactor);  // 9-13px
    const labelSpacing = Math.round(6 + 4 * zoomFactor); // 6-10px
    
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    
    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1];
      const curr = clusters[i];
      
      if (curr.timeSincePrev && curr.timeSincePrev > GAP_THRESHOLD) {
        // Draw dashed line connecting clusters
        const isNegative = curr.pctSincePrev !== null && curr.pctSincePrev < 0;
        ctx.strokeStyle = isNegative ? 'rgba(239, 83, 80, 0.5)' : 'rgba(38, 166, 154, 0.5)';
        
        const startX = prev.x + BUBBLE_RADIUS + 4;
        const startY = prev.y;
        const endX = curr.x - BUBBLE_RADIUS - 4;
        const endY = curr.y;
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        // Draw labels at midpoint of the gap line (always shown)
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        ctx.setLineDash([]); // Reset for text
        
        // Time since previous (e.g., "3d")
        if (curr.timeSincePrev > 3600) {
          ctx.font = `${timeFontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#787B86';
          ctx.fillText(formatTimeGap(curr.timeSincePrev), midX, midY - labelSpacing);
        }
        
        // Price change (e.g., "-20.6%")
        if (curr.pctSincePrev !== null) {
          const pctColor = curr.pctSincePrev >= 0 ? '#26A69A' : '#EF5350';
          ctx.font = `bold ${pctFontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = pctColor;
          ctx.fillText(formatPctChange(curr.pctSincePrev), midX, midY + labelSpacing);
        }
        
        ctx.setLineDash([6, 4]); // Restore for next line
      }
    }
    ctx.setLineDash([]);

    // Draw clusters
    for (const cluster of clusters) {
      const { x, y, tweets: clusterTweets } = cluster;
      const count = clusterTweets.length;
      const isMultiple = count > 1;
      const isSingleHovered = !isMultiple && hovered?.tweet_id === clusterTweets[0].tweet_id;
      const isClusterHovered = isMultiple && clusterTweets.some(t => hovered?.tweet_id === t.tweet_id);
      const isHovered = isSingleHovered || isClusterHovered;

      // Hover glow
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, BUBBLE_RADIUS + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(41, 98, 255, 0.3)';
        ctx.fill();
      }

      // Multiple tweets indicator (blue glow behind)
      if (isMultiple) {
        ctx.beginPath();
        ctx.arc(x, y, BUBBLE_RADIUS + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(41, 98, 255, 0.4)';
        ctx.fill();
      }

      // Border
      ctx.beginPath();
      ctx.arc(x, y, BUBBLE_RADIUS + 2, 0, Math.PI * 2);
      ctx.strokeStyle = isHovered ? '#2962FF' : '#FFFFFF';
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();

      // Avatar or count badge
      if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, BUBBLE_RADIUS, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, x - BUBBLE_RADIUS, y - BUBBLE_RADIUS, BUBBLE_SIZE, BUBBLE_SIZE);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, BUBBLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#2962FF';
        ctx.fill();
      }

      // Multiple count badge
      if (isMultiple) {
        const badgeSize = Math.max(14, BUBBLE_SIZE * 0.4);
        const badgeX = x + BUBBLE_RADIUS - badgeSize / 2;
        const badgeY = y - BUBBLE_RADIUS + badgeSize / 3;
        
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeSize / 2 + 2, 0, Math.PI * 2);
        ctx.fillStyle = '#2962FF';
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
  }, []);

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
      upColor: 'rgba(38, 166, 154, 0.3)',
      downColor: 'rgba(239, 83, 80, 0.3)',
      borderUpColor: 'rgba(38, 166, 154, 0.4)',
      borderDownColor: 'rgba(239, 83, 80, 0.4)',
      wickUpColor: 'rgba(38, 166, 154, 0.3)',
      wickDownColor: 'rgba(239, 83, 80, 0.3)',
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
        setHoveredTweet(null);
        return;
      }

      const { x, y } = param.point;
      const HOVER_RADIUS = 24;
      const tweets = tweetEventsRef.current;

      let found: TweetEvent | null = null;
      let foundX = 0, foundY = 0;

      for (const tweet of tweets) {
        if (!tweet.price_at_tweet) continue;

        const nearestTime = findNearestCandleTime(tweet.timestamp);
        const tx = nearestTime ? chart.timeScale().timeToCoordinate(nearestTime as Time) : null;
        const ty = series.priceToCoordinate(tweet.price_at_tweet);

        if (tx === null || ty === null) continue;

        const dist = Math.hypot(tx - x, ty - y);
        if (dist < HOVER_RADIUS) {
          found = tweet;
          foundX = tx;
          foundY = ty;
          break;
        }
      }

      if (found) {
        setHoveredTweet(found);
        setTooltipPos({ x: foundX, y: foundY });
      } else {
        setHoveredTweet(null);
      }
    });

    chart.subscribeClick((param: MouseEventParams) => {
      if (!param.point) return;

      const { x, y } = param.point;
      const CLICK_RADIUS = 24;
      const tweets = tweetEventsRef.current;

      for (const tweet of tweets) {
        if (!tweet.price_at_tweet) continue;

        const nearestTime = findNearestCandleTime(tweet.timestamp);
        const tx = nearestTime ? chart.timeScale().timeToCoordinate(nearestTime as Time) : null;
        const ty = series.priceToCoordinate(tweet.price_at_tweet);

        if (tx === null || ty === null) continue;

        const dist = Math.hypot(tx - x, ty - y);
        if (dist < CLICK_RADIUS) {
          window.open(`https://twitter.com/a1lon9/status/${tweet.tweet_id}`, '_blank');
          break;
        }
      }
    });

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [drawMarkers]);

  const findNearestCandleTime = (timestamp: number): number | null => {
    const times = candleTimesRef.current;
    if (times.length === 0) return null;
    
    let left = 0;
    let right = times.length - 1;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (times[mid] < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    if (left > 0) {
      const diffLeft = Math.abs(times[left] - timestamp);
      const diffPrev = Math.abs(times[left - 1] - timestamp);
      if (diffPrev < diffLeft) return times[left - 1];
    }
    return times[left];
  };

  // Load data when timeframe changes
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setDataLoaded(false);
      
      try {
        const priceData = await loadPrices(timeframe);
        
        candlesRef.current = priceData.candles;
        candleTimesRef.current = priceData.candles.map(c => c.t);
        
        if (seriesRef.current && chartRef.current) {
          const chartData = toCandlestickData(priceData);
          seriesRef.current.setData(chartData as CandlestickData<Time>[]);
          
          const tweetsWithPrice = tweetEvents.filter(t => t.price_at_tweet !== null);
          if (tweetsWithPrice.length > 0 && priceData.candles.length > 0) {
            const firstTweetTime = tweetsWithPrice[0].timestamp;
            const lastDataTime = priceData.end;
            
            chartRef.current.timeScale().setVisibleRange({
              from: firstTweetTime as Time,
              to: lastDataTime as Time,
            });
          } else {
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
  }, [timeframe, tweetEvents]);

  // Redraw when state changes
  useEffect(() => {
    if (dataLoaded) {
      const timer = setTimeout(() => {
        drawMarkers();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [dataLoaded, showBubbles, hoveredTweet, avatarLoaded, drawMarkers]);

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
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              timeframe === tf.value
                ? 'bg-[#2962FF] text-white'
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
      
      {/* Legend (bottom right) */}
      {showBubbles && (
        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-3 bg-[#1E222D]/90 px-3 py-1.5 rounded text-[10px]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border border-white bg-transparent" />
            <span className="text-[#D1D4DC]">Single tweet</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <div className="w-3 h-3 rounded-full border border-white bg-[#2962FF]/40" />
              <span className="absolute -top-0.5 -right-1 text-[7px] text-white font-bold bg-[#2962FF] rounded-full w-2.5 h-2.5 flex items-center justify-center">3</span>
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
          <div className="w-3 h-3 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#787B86]">Loading...</span>
        </div>
      )}

      {/* Tweet tooltip */}
      {hoveredTweet && (
        <div
          className="absolute z-30 pointer-events-none bg-[#1E222D] border border-[#2A2E39] rounded-lg p-3 shadow-xl max-w-xs"
          style={{
            left: Math.min(tooltipPos.x + 20, (containerRef.current?.clientWidth || 400) - 300),
            top: Math.max(tooltipPos.y - 60, 10),
          }}
        >
          <div className="flex items-start gap-2 mb-2">
            <img src="/avatars/a1lon9.png" alt="Alon" className="w-8 h-8 rounded-full" />
            <div>
              <div className="text-[#D1D4DC] font-medium text-sm">@a1lon9</div>
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
          <div className="mt-2 text-xs text-[#2962FF]">Click bubble to view tweet →</div>
        </div>
      )}
    </div>
  );
}
