'use client';

/**
 * TweetImpactCard - Screenshot-worthy tweet impact visualization
 * ==============================================================
 * 
 * Inspired by fomo.com's position cards. Designed for maximum
 * propositional density - every element tells part of the story.
 * 
 * "Founder said X, price did Y" - in one shareable image.
 */

import { useEffect, useState } from 'react';
import { TweetEvent, Asset, Candle } from '@/lib/types';
import { loadPrices } from '@/lib/dataLoader';
import Sparkline from './Sparkline';

interface TweetImpactCardProps {
  /** The tweet to display */
  tweet: TweetEvent;
  /** Asset metadata */
  asset: Asset;
  /** Callback to close the card */
  onClose: () => void;
}

/**
 * Decode HTML entities in text (&gt; &amp; &lt; etc)
 */
function decodeHtmlEntities(text: string): string {
  if (typeof document === 'undefined') return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Format price with appropriate decimal places
 */
function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

/**
 * Format percentage with sign
 */
function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Format date for display
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TweetImpactCard({
  tweet,
  asset,
  onClose,
}: TweetImpactCardProps) {
  const [sparklineData, setSparklineData] = useState<number[]>([]);
  const [markerIndex, setMarkerIndex] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Fetch 7 days of price data centered on the tweet
  useEffect(() => {
    async function loadSparklineData() {
      try {
        // Load 1h data for the sparkline (gives good resolution)
        const priceData = await loadPrices(asset.id, '1h');
        
        if (!priceData || !priceData.candles.length) {
          setLoading(false);
          return;
        }

        // Find candles within 3.5 days before and after the tweet (7 day window)
        const windowSize = 3.5 * 24 * 60 * 60; // 3.5 days in seconds
        const tweetTime = tweet.timestamp;
        
        const relevantCandles = priceData.candles.filter(
          (c: Candle) => c.t >= tweetTime - windowSize && c.t <= tweetTime + windowSize
        );

        if (relevantCandles.length < 2) {
          // Fallback: just use all available data
          const prices = priceData.candles.slice(-168).map((c: Candle) => c.c); // Last 7 days
          setSparklineData(prices);
          
          // Find marker position
          const tweetCandle = priceData.candles.findIndex(
            (c: Candle) => Math.abs(c.t - tweetTime) < 3600
          );
          if (tweetCandle >= 0) {
            const offset = priceData.candles.length - 168;
            setMarkerIndex(Math.max(0, tweetCandle - offset));
          }
        } else {
          // Use the windowed data
          const prices = relevantCandles.map((c: Candle) => c.c);
          setSparklineData(prices);
          
          // Find marker position in windowed data
          const markerIdx = relevantCandles.findIndex(
            (c: Candle) => Math.abs(c.t - tweetTime) < 3600
          );
          setMarkerIndex(markerIdx >= 0 ? markerIdx : Math.floor(relevantCandles.length / 2));
        }
      } catch (error) {
        console.error('[TweetImpactCard] Failed to load sparkline data:', error);
      }
      setLoading(false);
    }

    loadSparklineData();
  }, [tweet.timestamp, asset.id]);

  // Determine hero percentage (whichever has larger magnitude)
  const change1h = tweet.change_1h_pct;
  const change24h = tweet.change_24h_pct;
  
  let heroChange: number | null = null;
  let heroLabel = '';
  
  if (change1h !== null && change24h !== null) {
    if (Math.abs(change1h) >= Math.abs(change24h)) {
      heroChange = change1h;
      heroLabel = '1h after';
    } else {
      heroChange = change24h;
      heroLabel = '24h after';
    }
  } else if (change24h !== null) {
    heroChange = change24h;
    heroLabel = '24h after';
  } else if (change1h !== null) {
    heroChange = change1h;
    heroLabel = '1h after';
  }

  const isPositive = heroChange !== null && heroChange >= 0;
  const decodedText = decodeHtmlEntities(tweet.text);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Card - centered on desktop, bottom sheet on mobile */}
      <div className="fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div 
          className="
            pointer-events-auto
            w-full max-w-[400px]
            bg-gradient-to-b from-[#1a1a1f] to-[#0f0f12]
            rounded-2xl
            border border-white/10
            shadow-2xl shadow-black/50
            overflow-hidden
            animate-scale-in
          "
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header: Token + Date */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              {asset.logo ? (
                <img 
                  src={asset.logo} 
                  alt={asset.name}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: asset.color }}
                >
                  {asset.name.charAt(0)}
                </div>
              )}
              <span className="text-white font-semibold text-lg tracking-tight">
                ${asset.name}
              </span>
            </div>
            <span className="text-white/50 text-sm">
              {formatDate(tweet.timestamp)}
            </span>
          </div>

          {/* Sparkline Chart */}
          <div className="px-5 py-2">
            <div className="bg-black/30 rounded-xl p-3 border border-white/5">
              {loading ? (
                <div className="h-[80px] flex items-center justify-center">
                  <div className="animate-pulse text-white/30 text-sm">Loading chart...</div>
                </div>
              ) : sparklineData.length > 0 ? (
                <Sparkline
                  data={sparklineData}
                  markerIndex={markerIndex}
                  color={asset.color}
                  width={340}
                  height={80}
                />
              ) : (
                <div className="h-[80px] flex items-center justify-center">
                  <div className="text-white/30 text-sm">No price data</div>
                </div>
              )}
            </div>
          </div>

          {/* Tweet Content Card */}
          <div className="px-5 py-3">
            <div className="bg-[#0d0d10] rounded-xl p-4 border border-white/5">
              {/* Founder attribution */}
              <div className="text-white/50 text-sm mb-2">
                @{asset.founder}&apos;s tweet
              </div>

              {/* Tweet text */}
              <p className="text-white text-[15px] leading-relaxed mb-4 line-clamp-4">
                &ldquo;{decodedText}&rdquo;
              </p>

              {/* Hero percentage */}
              {heroChange !== null && (
                <div className="text-center mb-4">
                  <div 
                    className={`text-4xl font-bold tracking-tight ${
                      isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'
                    }`}
                  >
                    {isPositive ? '▲' : '▼'} {formatPct(heroChange)}
                  </div>
                  <div className="text-white/40 text-sm mt-1">
                    {heroLabel}
                  </div>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
                <div className="text-center">
                  <div className="text-white/40 text-xs mb-1">Price</div>
                  <div className="text-white font-medium text-sm">
                    {tweet.price_at_tweet ? formatPrice(tweet.price_at_tweet) : '—'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-white/40 text-xs mb-1">1h</div>
                  <div className={`font-medium text-sm ${
                    change1h !== null 
                      ? change1h >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
                      : 'text-white/30'
                  }`}>
                    {formatPct(change1h)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-white/40 text-xs mb-1">24h</div>
                  <div className={`font-medium text-sm ${
                    change24h !== null 
                      ? change24h >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
                      : 'text-white/30'
                  }`}>
                    {formatPct(change24h)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer branding */}
          <div className="px-5 pb-5 pt-2">
            <div className="text-center text-white/30 text-xs">
              tweetprice.xyz
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

