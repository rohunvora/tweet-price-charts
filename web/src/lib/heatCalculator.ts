/**
 * Alpha Calculator for Market-Relative Performance
 * 
 * Computes "alpha" = PUMP return - SOL return
 * This shows whether PUMP is outperforming or underperforming the market,
 * independent of any assumptions about tweets.
 * 
 * Users can then overlay tweet bubbles and discover correlations themselves.
 */

// Color gradient: Green (outperforming) → Gray (neutral) → Red (underperforming)
export const ALPHA_GRADIENT = [
  { stop: 1.0, color: '#00C853' },  // Deep Green (strong outperformance)
  { stop: 0.7, color: '#69F0AE' },  // Light Green
  { stop: 0.5, color: '#78909C' },  // Gray (neutral - tracking market)
  { stop: 0.3, color: '#FF8A80' },  // Light Red
  { stop: 0.0, color: '#D50000' },  // Deep Red (strong underperformance)
];

// For backwards compatibility, export as HEAT_GRADIENT too
export const HEAT_GRADIENT = ALPHA_GRADIENT;

/**
 * Calculate alpha (excess return vs market)
 * 
 * @param pumpReturn - PUMP's return over the period (e.g., 0.05 = 5%)
 * @param solReturn - SOL's return over the period
 * @returns Alpha value (positive = outperforming, negative = underperforming)
 */
export function calculateAlpha(pumpReturn: number, solReturn: number): number {
  return pumpReturn - solReturn;
}

/**
 * Normalize alpha to a 0-1 scale for color mapping
 * 
 * We use historical volatility to normalize:
 * - ±5% alpha in a single candle is significant
 * - Scale so ±10% maps to the extremes
 * 
 * @param alpha - Raw alpha value
 * @param scale - Scaling factor (default: 0.10 = 10% is extreme)
 * @returns Normalized value from 0 (very negative) to 1 (very positive)
 */
export function normalizeAlpha(alpha: number, scale: number = 0.10): number {
  // Map alpha to [-1, 1] range using scale
  const normalized = alpha / scale;
  
  // Clamp to [-1, 1] then map to [0, 1]
  const clamped = Math.max(-1, Math.min(1, normalized));
  return (clamped + 1) / 2;
}

/**
 * Combined function: calculate and normalize alpha for color mapping
 * 
 * @param pumpReturn - PUMP's return
 * @param solReturn - SOL's return  
 * @param scale - Scaling factor for normalization
 * @returns Value from 0 (underperforming) to 1 (outperforming)
 */
export function calculateNormalizedAlpha(
  pumpReturn: number, 
  solReturn: number,
  scale: number = 0.10
): number {
  const alpha = calculateAlpha(pumpReturn, solReturn);
  return normalizeAlpha(alpha, scale);
}

/**
 * Parse hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to hex string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(x).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Interpolate between two colors
 */
function lerpColor(color1: string, color2: string, t: number): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  
  return rgbToHex(
    c1.r + (c2.r - c1.r) * t,
    c1.g + (c2.g - c1.g) * t,
    c1.b + (c2.b - c1.b) * t
  );
}

/**
 * Interpolate color based on normalized alpha value
 * 
 * @param normalizedAlpha - Value from 0 (red/underperforming) to 1 (green/outperforming)
 * @returns Hex color string
 */
export function interpolateColor(normalizedAlpha: number): string {
  const value = Math.max(0, Math.min(1, normalizedAlpha));
  
  // Find the two gradient stops to interpolate between
  let lowerStop = ALPHA_GRADIENT[ALPHA_GRADIENT.length - 1];
  let upperStop = ALPHA_GRADIENT[0];
  
  for (let i = 0; i < ALPHA_GRADIENT.length - 1; i++) {
    if (value <= ALPHA_GRADIENT[i].stop && value >= ALPHA_GRADIENT[i + 1].stop) {
      upperStop = ALPHA_GRADIENT[i];
      lowerStop = ALPHA_GRADIENT[i + 1];
      break;
    }
  }
  
  const range = upperStop.stop - lowerStop.stop;
  if (range === 0) return upperStop.color;
  
  const t = (value - lowerStop.stop) / range;
  return lerpColor(lowerStop.color, upperStop.color, t);
}

/**
 * Get human-readable label for current alpha state
 */
export function getAlphaLabel(alpha: number): { label: string; emoji: string } {
  if (alpha > 0.05) return { label: 'Outperforming', emoji: '🟢' };
  if (alpha > 0.01) return { label: 'Beating Market', emoji: '🟢' };
  if (alpha > -0.01) return { label: 'Tracking Market', emoji: '⚪' };
  if (alpha > -0.05) return { label: 'Underperforming', emoji: '🔴' };
  return { label: 'Lagging Market', emoji: '🔴' };
}

// ============================================
// LEGACY EXPORTS (for backwards compatibility)
// ============================================

/**
 * @deprecated Use calculateNormalizedAlpha instead
 * Kept for backwards compatibility during transition
 */
export function calculateHeat(daysSinceTweet: number, _visibleRangeDays?: number): number {
  // This function is deprecated - Chart.tsx should use alpha-based calculation
  // Return 0.5 (neutral) as fallback
  console.warn('calculateHeat is deprecated. Use calculateNormalizedAlpha instead.');
  return 0.5;
}

/**
 * @deprecated Use getAlphaLabel instead
 */
export function getHeatLabel(daysSinceTweet: number): { label: string; emoji: string } {
  return { label: 'N/A', emoji: '⚪' };
}

/**
 * @deprecated Not needed for alpha calculation
 */
export function findDaysSinceLastTweet(
  timestamp: number,
  sortedTweetTimestamps: number[]
): number {
  return 0;
}

// Export founder stats for potential future use
export const FOUNDER_STATS = {
  alon: {
    medianGapDays: 0.8,
    p90GapDays: 3.2,
    p99GapDays: 8.8,
    maxHistoricalGapDays: 12.1,
  }
};
