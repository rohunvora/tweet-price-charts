'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { TweetEvent, Asset } from '@/lib/types';
import { loadAssets, loadTweetEvents } from '@/lib/dataLoader';

// =============================================================================
// Types
// =============================================================================

interface DataPoint {
  asset: Asset;
  event: TweetEvent;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
}

interface TooltipData {
  point: DataPoint;
  screenX: number;
  screenY: number;
}

type TimeRange = 'all' | '30d' | '90d' | '1y';
type ImpactMetric = '1h' | '24h';

// =============================================================================
// Constants
// =============================================================================

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All time' },
];

const IMPACT_METRICS: { value: ImpactMetric; label: string }[] = [
  { value: '1h', label: '1h impact' },
  { value: '24h', label: '24h impact' },
];

// =============================================================================
// Component
// =============================================================================

export default function ImpactExplorer() {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [assets, setAssets] = useState<Asset[]>([]);
  const [allData, setAllData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedAsset, setSelectedAsset] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [impactMetric, setImpactMetric] = useState<ImpactMetric>('1h');

  // Interaction
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null);

  // ---------------------------------------------------------------------------
  // Data Loading
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const loadedAssets = await loadAssets();
        setAssets(loadedAssets);

        // Load tweet events for all assets in parallel
        const allPoints: DataPoint[] = [];

        await Promise.all(
          loadedAssets.map(async (asset) => {
            try {
              const tweetsData = await loadTweetEvents(asset.id);

              tweetsData.events.forEach((event) => {
                // Only include events with valid price impact data
                if (event.change_1h_pct !== null && event.change_24h_pct !== null) {
                  allPoints.push({
                    asset,
                    event,
                    x: 0, // Will be normalized later
                    y: 0, // Will be normalized later
                  });
                }
              });
            } catch (e) {
              console.warn(`Failed to load tweets for ${asset.id}:`, e);
            }
          })
        );

        setAllData(allPoints);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // ---------------------------------------------------------------------------
  // Filtered & Normalized Data
  // ---------------------------------------------------------------------------
  const { filteredData, stats, xDomain, yDomain } = useMemo(() => {
    if (allData.length === 0) {
      return {
        filteredData: [],
        stats: { total: 0, positive: 0, avgImpact: 0 },
        xDomain: [0, 1] as [number, number],
        yDomain: [-50, 50] as [number, number],
      };
    }

    const now = Date.now() / 1000;
    const timeFilters: Record<TimeRange, number> = {
      '30d': now - 30 * 24 * 60 * 60,
      '90d': now - 90 * 24 * 60 * 60,
      '1y': now - 365 * 24 * 60 * 60,
      'all': 0,
    };

    // Filter by asset and time
    let filtered = allData.filter((point) => {
      if (selectedAsset !== 'all' && point.asset.id !== selectedAsset) return false;
      if (point.event.timestamp < timeFilters[timeRange]) return false;
      return true;
    });

    if (filtered.length === 0) {
      return {
        filteredData: [],
        stats: { total: 0, positive: 0, avgImpact: 0 },
        xDomain: [0, 1] as [number, number],
        yDomain: [-50, 50] as [number, number],
      };
    }

    // Get the impact value based on selected metric
    const getImpact = (point: DataPoint) =>
      impactMetric === '1h' ? point.event.change_1h_pct! : point.event.change_24h_pct!;

    // Calculate domains
    const timestamps = filtered.map(p => p.event.timestamp);
    const impacts = filtered.map(getImpact);

    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    // Clamp impact values for visualization (outliers still shown at edges)
    const impactRange = 100; // -100% to +100%
    const minImpact = -impactRange;
    const maxImpact = impactRange;

    // Normalize coordinates
    const timeSpan = maxTime - minTime || 1;

    filtered = filtered.map(point => ({
      ...point,
      x: (point.event.timestamp - minTime) / timeSpan,
      y: Math.max(0, Math.min(1, (getImpact(point) - minImpact) / (maxImpact - minImpact))),
    }));

    // Calculate stats
    const positiveCount = impacts.filter(i => i > 0).length;
    const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;

    return {
      filteredData: filtered,
      stats: {
        total: filtered.length,
        positive: positiveCount,
        avgImpact,
      },
      xDomain: [minTime, maxTime] as [number, number],
      yDomain: [minImpact, maxImpact] as [number, number],
    };
  }, [allData, selectedAsset, timeRange, impactMetric]);

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------
  const handlePointHover = useCallback((point: DataPoint | null, e?: React.MouseEvent) => {
    setHoveredPoint(point);
    if (point && e) {
      setTooltip({
        point,
        screenX: e.clientX,
        screenY: e.clientY,
      });
    } else {
      setTooltip(null);
    }
  }, []);

  const handlePointClick = useCallback((point: DataPoint) => {
    // Open tweet in new tab
    window.open(`https://x.com/i/status/${point.event.tweet_id}`, '_blank');
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--surface-2)] rounded w-1/3"></div>
          <div className="h-[300px] bg-[var(--surface-2)] rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl p-6">
        <p className="text-[var(--negative)]">Error: {error}</p>
      </div>
    );
  }

  const positiveRate = stats.total > 0 ? (stats.positive / stats.total * 100).toFixed(0) : 0;

  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-subtle)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Impact Explorer
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Every dot is a tweet. Hover to see details, click to open.
        </p>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-[var(--border-subtle)] flex flex-wrap gap-3">
        {/* Asset Filter */}
        <select
          value={selectedAsset}
          onChange={(e) => setSelectedAsset(e.target.value)}
          className="px-3 py-1.5 text-sm bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All assets ({allData.length} tweets)</option>
          {assets.map((asset) => {
            const count = allData.filter(p => p.asset.id === asset.id).length;
            return (
              <option key={asset.id} value={asset.id}>
                {asset.name} ({count})
              </option>
            );
          })}
        </select>

        {/* Time Range Filter */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--border-subtle)]">
          {TIME_RANGES.map((range) => (
            <button
              key={range.value}
              onClick={() => setTimeRange(range.value)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                timeRange === range.value
                  ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        {/* Impact Metric Toggle */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--border-subtle)]">
          {IMPACT_METRICS.map((metric) => (
            <button
              key={metric.value}
              onClick={() => setImpactMetric(metric.value)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                impactMetric === metric.value
                  ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {metric.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative p-4">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-4 bottom-4 w-12 flex flex-col justify-between text-xs text-[var(--text-muted)] pr-2">
          <span className="text-[var(--positive)]">+100%</span>
          <span>0%</span>
          <span className="text-[var(--negative)]">-100%</span>
        </div>

        {/* Chart area */}
        <div className="ml-12">
          <svg
            viewBox="0 0 800 400"
            className="w-full h-[300px] md:h-[400px]"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Background */}
            <rect x="0" y="0" width="800" height="400" fill="var(--surface-0)" rx="8" />

            {/* Grid lines */}
            <line x1="0" y1="200" x2="800" y2="200" stroke="var(--border-default)" strokeDasharray="4 4" />
            <line x1="0" y1="100" x2="800" y2="100" stroke="var(--border-subtle)" strokeDasharray="2 2" />
            <line x1="0" y1="300" x2="800" y2="300" stroke="var(--border-subtle)" strokeDasharray="2 2" />

            {/* Zero line label */}
            <text x="4" y="204" fill="var(--text-muted)" fontSize="10">0%</text>

            {/* Data points */}
            {filteredData.map((point, i) => {
              const cx = point.x * 780 + 10;
              const cy = (1 - point.y) * 380 + 10; // Invert Y (higher = top)
              const impact = impactMetric === '1h' ? point.event.change_1h_pct! : point.event.change_24h_pct!;
              const isPositive = impact >= 0;
              const isHovered = hoveredPoint === point;

              return (
                <circle
                  key={`${point.asset.id}-${point.event.tweet_id}-${i}`}
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 8 : 5}
                  fill={isPositive ? 'var(--positive)' : 'var(--negative)'}
                  fillOpacity={isHovered ? 1 : 0.6}
                  stroke={isHovered ? 'white' : 'none'}
                  strokeWidth={2}
                  className="cursor-pointer transition-all duration-150"
                  onMouseEnter={(e) => handlePointHover(point, e)}
                  onMouseLeave={() => handlePointHover(null)}
                  onClick={() => handlePointClick(point)}
                />
              );
            })}

            {/* Empty state */}
            {filteredData.length === 0 && (
              <text x="400" y="200" textAnchor="middle" fill="var(--text-muted)" fontSize="14">
                No data for selected filters
              </text>
            )}
          </svg>

          {/* X-axis labels */}
          <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2 px-2">
            <span>{xDomain[0] ? new Date(xDomain[0] * 1000).toLocaleDateString() : ''}</span>
            <span>{xDomain[1] ? new Date(xDomain[1] * 1000).toLocaleDateString() : ''}</span>
          </div>
        </div>
      </div>

      {/* Stats Footer */}
      <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--surface-0)]">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
              {stats.total.toLocaleString()}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">tweets</div>
          </div>
          <div>
            <div className={`text-2xl font-bold tabular-nums ${
              Number(positiveRate) >= 50 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'
            }`}>
              {positiveRate}%
            </div>
            <div className="text-xs text-[var(--text-secondary)]">positive {impactMetric}</div>
          </div>
          <div>
            <div className={`text-2xl font-bold tabular-nums ${
              stats.avgImpact >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'
            }`}>
              {stats.avgImpact >= 0 ? '+' : ''}{stats.avgImpact.toFixed(1)}%
            </div>
            <div className="text-xs text-[var(--text-secondary)]">avg {impactMetric} impact</div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none tooltip-enter"
          style={{
            left: tooltip.screenX + 12,
            top: tooltip.screenY - 12,
            transform: 'translateY(-100%)',
          }}
        >
          <div className="bg-[var(--surface-3)] border border-[var(--border-default)] rounded-lg p-3 shadow-xl max-w-xs">
            {/* Asset & Time */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: tooltip.point.asset.color }}
              />
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {tooltip.point.asset.name}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {new Date(tooltip.point.event.timestamp * 1000).toLocaleDateString()}
              </span>
            </div>

            {/* Tweet text */}
            <p className="text-sm text-[var(--text-secondary)] mb-2 line-clamp-3">
              {tooltip.point.event.text}
            </p>

            {/* Impact stats */}
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-[var(--text-muted)]">1h: </span>
                <span className={tooltip.point.event.change_1h_pct! >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
                  {tooltip.point.event.change_1h_pct! >= 0 ? '+' : ''}
                  {tooltip.point.event.change_1h_pct!.toFixed(1)}%
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">24h: </span>
                <span className={tooltip.point.event.change_24h_pct! >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
                  {tooltip.point.event.change_24h_pct! >= 0 ? '+' : ''}
                  {tooltip.point.event.change_24h_pct!.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Click hint */}
            <div className="text-xs text-[var(--text-muted)] mt-2 pt-2 border-t border-[var(--border-subtle)]">
              Click to open tweet →
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
