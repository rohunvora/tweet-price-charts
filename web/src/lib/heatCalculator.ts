// Alpha calculation for market-relative performance visualization

export interface GradientStop {
  position: number;
  color: string;
}

// Color gradient for alpha visualization (red = underperforming, green = outperforming)
export const ALPHA_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#D50000' },   // Deep red - big loser
  { position: 0.25, color: '#FF5252' },  // Light red
  { position: 0.5, color: '#787B86' },   // Neutral gray
  { position: 0.75, color: '#69F0AE' },  // Light green
  { position: 1.0, color: '#00C853' },   // Deep green - big winner
];

/**
 * Calculate normalized alpha for color mapping
 * Maps the alpha value to 0-1 range based on threshold
 */
export function calculateNormalizedAlpha(
  assetReturn: number,
  benchmarkReturn: number,
  threshold: number
): number {
  const alpha = assetReturn - benchmarkReturn;
  
  // Clamp to [-threshold, +threshold] then normalize to [0, 1]
  const clamped = Math.max(-threshold, Math.min(threshold, alpha));
  return (clamped + threshold) / (2 * threshold);
}

/**
 * Interpolate color from gradient based on normalized value (0-1)
 */
export function interpolateColor(normalizedValue: number): string {
  const t = Math.max(0, Math.min(1, normalizedValue));
  
  // Find the two gradient stops to interpolate between
  let lowerStop = ALPHA_GRADIENT[0];
  let upperStop = ALPHA_GRADIENT[ALPHA_GRADIENT.length - 1];
  
  for (let i = 0; i < ALPHA_GRADIENT.length - 1; i++) {
    if (t >= ALPHA_GRADIENT[i].position && t <= ALPHA_GRADIENT[i + 1].position) {
      lowerStop = ALPHA_GRADIENT[i];
      upperStop = ALPHA_GRADIENT[i + 1];
      break;
    }
  }
  
  // Interpolate between the two stops
  const range = upperStop.position - lowerStop.position;
  const localT = range > 0 ? (t - lowerStop.position) / range : 0;
  
  return lerpColor(lowerStop.color, upperStop.color, localT);
}

/**
 * Linear interpolate between two hex colors
 */
function lerpColor(color1: string, color2: string, t: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);
  
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Get human-readable label for current alpha
 */
export function getAlphaLabel(alpha: number): { label: string; emoji: string } {
  if (alpha > 0.05) return { label: 'Crushing it', emoji: '🚀' };
  if (alpha > 0.02) return { label: 'Outperforming', emoji: '📈' };
  if (alpha > 0.005) return { label: 'Beating market', emoji: '✨' };
  if (alpha > -0.005) return { label: 'Market neutral', emoji: '➡️' };
  if (alpha > -0.02) return { label: 'Trailing market', emoji: '📉' };
  if (alpha > -0.05) return { label: 'Underperforming', emoji: '😬' };
  return { label: 'Getting rekt', emoji: '💀' };
}

/**
 * Format time gap as human-readable string
 */
export function formatTimeGap(seconds: number): string {
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/**
 * Format percentage change
 */
export function formatPctChange(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  if (Math.abs(pct) >= 10) return `${sign}${pct.toFixed(0)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

