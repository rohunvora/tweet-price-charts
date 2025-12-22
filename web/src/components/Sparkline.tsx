'use client';

/**
 * Sparkline - Minimal SVG sparkline chart
 * ========================================
 * 
 * A lightweight, dependency-free sparkline for the Tweet Impact Card.
 * Renders price data as a smooth line with an optional marker point.
 */

interface SparklineProps {
  /** Array of price values to plot */
  data: number[];
  /** Index in data array where to show the marker (tweet moment) */
  markerIndex?: number;
  /** Line color (usually asset color) */
  color: string;
  /** Chart width in pixels */
  width?: number;
  /** Chart height in pixels */
  height?: number;
  /** Whether to show gradient fill under the line */
  showFill?: boolean;
}

export default function Sparkline({
  data,
  markerIndex,
  color,
  width = 300,
  height = 80,
  showFill = true,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <text x="50%" y="50%" textAnchor="middle" fill="currentColor" fontSize="12">
          No data
        </text>
      </svg>
    );
  }

  // Calculate min/max for scaling
  const minValue = Math.min(...data);
  const maxValue = Math.max(...data);
  const range = maxValue - minValue || 1; // Avoid division by zero

  // Padding to prevent clipping at edges
  const padding = { top: 8, bottom: 8, left: 4, right: 4 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Convert data points to SVG coordinates
  const points = data.map((value, index) => {
    const x = padding.left + (index / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - minValue) / range) * chartHeight;
    return { x, y, value };
  });

  // Create smooth path using quadratic bezier curves
  const pathD = points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    
    // Use quadratic bezier for smoothing
    const prev = points[index - 1];
    const midX = (prev.x + point.x) / 2;
    
    return `${path} Q ${prev.x} ${prev.y} ${midX} ${(prev.y + point.y) / 2} T ${point.x} ${point.y}`;
  }, '');

  // Create fill path (extends to bottom)
  const fillPathD = `${pathD} L ${points[points.length - 1].x} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  // Get marker point if specified
  const markerPoint = markerIndex !== undefined && markerIndex >= 0 && markerIndex < points.length
    ? points[markerIndex]
    : null;

  // Generate unique ID for gradient
  const gradientId = `sparkline-gradient-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <svg 
      width={width} 
      height={height} 
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        {/* Gradient fill for area under line */}
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Filled area under the line */}
      {showFill && (
        <path
          d={fillPathD}
          fill={`url(#${gradientId})`}
        />
      )}

      {/* Main line */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Marker at tweet moment */}
      {markerPoint && (
        <>
          {/* Vertical line from marker to bottom */}
          <line
            x1={markerPoint.x}
            y1={markerPoint.y}
            x2={markerPoint.x}
            y2={height - padding.bottom}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3,3"
            opacity={0.5}
          />
          
          {/* Outer glow ring */}
          <circle
            cx={markerPoint.x}
            cy={markerPoint.y}
            r={8}
            fill={color}
            opacity={0.2}
          />
          
          {/* Inner marker dot */}
          <circle
            cx={markerPoint.x}
            cy={markerPoint.y}
            r={5}
            fill={color}
            stroke="#0D0C0B"
            strokeWidth={2}
          />
        </>
      )}
    </svg>
  );
}

