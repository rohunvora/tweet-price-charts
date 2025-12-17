'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CrosshairMode,
  CandlestickSeries,
} from 'lightweight-charts';
import { Timeframe, TweetEvent, Candle } from '@/lib/types';
import { loadPrices, toCandlestickData, getTimeframeForRange } from '@/lib/dataLoader';
import MarkerCanvas from './MarkerCanvas';

interface ChartProps {
  tweetEvents: TweetEvent[];
  onTimeframeChange?: (tf: Timeframe) => void;
}

const TIMEFRAMES: Timeframe[] = ['1m', '15m', '1h', '1d'];

export default function Chart({ tweetEvents, onTimeframeChange }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [loading, setLoading] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 450,
      layout: {
        background: { color: '#0D1117' },
        textColor: '#8B949E',
      },
      grid: {
        vertLines: { color: '#21262D' },
        horzLines: { color: '#21262D' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#58A6FF',
          labelBackgroundColor: '#58A6FF',
        },
        horzLine: {
          color: '#58A6FF',
          labelBackgroundColor: '#58A6FF',
        },
      },
      timeScale: {
        borderColor: '#30363D',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#30363D',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      localization: {
        priceFormatter: (price: number) => price.toFixed(8),
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#3FB950',
      downColor: '#F85149',
      borderUpColor: '#3FB950',
      borderDownColor: '#F85149',
      wickUpColor: '#3FB950',
      wickDownColor: '#F85149',
    });

    chartRef.current = chart;
    seriesRef.current = series;
    console.log('Chart initialized, dimensions:', containerRef.current?.clientWidth, containerRef.current?.clientHeight);

    // Track visible range for marker positioning
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (logicalRange) {
        const barsInfo = series.barsInLogicalRange(logicalRange);
        if (barsInfo) {
          setVisibleRange({
            from: barsInfo.from as number,
            to: barsInfo.to as number,
          });
        }
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Load data when timeframe changes
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const priceData = await loadPrices(timeframe);
        console.log('Loaded price data:', timeframe, priceData.candles.length, 'candles');
        console.log('Sample candle:', priceData.candles[0]);
        setCandles(priceData.candles);
        
        if (seriesRef.current && chartRef.current && containerRef.current) {
          const chartData = toCandlestickData(priceData);
          console.log('Chart data sample:', JSON.stringify(chartData[0]));
          console.log('Chart data length:', chartData.length);
          
          // Ensure chart has correct dimensions before setting data
          const width = containerRef.current.clientWidth;
          const height = containerRef.current.clientHeight;
          if (width > 0 && height > 0) {
            chartRef.current.applyOptions({ width, height });
          }
          
          seriesRef.current.setData(chartData as CandlestickData<Time>[]);
          chartRef.current.timeScale().fitContent();
          console.log('Data set, final dimensions:', width, height);
        } else {
          console.log('Refs missing:', !!seriesRef.current, !!chartRef.current, !!containerRef.current);
        }
      } catch (error) {
        console.error('Failed to load price data:', error);
      }
      setLoading(false);
    }
    loadData();
    onTimeframeChange?.(timeframe);
  }, [timeframe, onTimeframeChange]);

  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setTimeframe(tf);
  }, []);

  // Get chart coordinate conversion functions for marker positioning
  const getCoordinateForPrice = useCallback((price: number): number | null => {
    if (!seriesRef.current) return null;
    return seriesRef.current.priceToCoordinate(price);
  }, []);

  const getCoordinateForTime = useCallback((time: number): number | null => {
    if (!chartRef.current) return null;
    return chartRef.current.timeScale().timeToCoordinate(time as Time);
  }, []);

  return (
    <div className="relative w-full h-full min-h-[500px] flex flex-col">
      {/* Timeframe selector */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#161B22] border-b border-[#30363D]">
        <span className="text-sm text-[#8B949E] mr-2">Timeframe:</span>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => handleTimeframeChange(tf)}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              timeframe === tf
                ? 'bg-[#238636] text-white'
                : 'bg-[#21262D] text-[#8B949E] hover:bg-[#30363D]'
            }`}
          >
            {tf}
          </button>
        ))}
        {loading && (
          <span className="ml-4 text-sm text-[#8B949E]">Loading...</span>
        )}
      </div>

      {/* Chart container */}
      <div className="relative flex-1 min-h-[450px]">
        <div ref={containerRef} className="absolute inset-0" />
        
        {/* Marker overlay canvas - temporarily disabled for debugging */}
        {false && !loading && candles.length > 0 && (
          <MarkerCanvas
            tweetEvents={tweetEvents}
            candles={candles}
            getCoordinateForPrice={getCoordinateForPrice}
            getCoordinateForTime={getCoordinateForTime}
            visibleRange={visibleRange}
          />
        )}
      </div>
    </div>
  );
}

