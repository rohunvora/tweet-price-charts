'use client';

import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import { TweetEvent } from '@/lib/types';

interface DataTableProps {
  events: TweetEvent[];
  founder: string;
  assetName: string;
}

const columnHelper = createColumnHelper<TweetEvent>();

/**
 * Decode HTML entities in text (&gt; &amp; &lt; etc)
 * Uses a textarea element to leverage browser's native decoding
 */
function decodeHtmlEntities(text: string): string {
  if (typeof document === 'undefined') return text; // SSR safety
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Compute tweet day statistics from events
 * Returns avg return and win rate for days with tweets
 */
function computeTweetDayStats(events: TweetEvent[]) {
  const eventsWithPrice = events.filter(e => e.change_24h_pct !== null);
  if (eventsWithPrice.length === 0) {
    return { avgReturn: 0, winRate: 0, count: 0 };
  }
  
  const returns = eventsWithPrice.map(e => e.change_24h_pct!);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const wins = returns.filter(r => r > 0).length;
  const winRate = (wins / returns.length) * 100;
  
  return {
    avgReturn: Math.round(avgReturn * 10) / 10,
    winRate: Math.round(winRate),
    count: eventsWithPrice.length
  };
}


/**
 * Tweet Days Stats Component
 * Shows avg return and win rate for tweet days
 */
function TweetDayStats({ events }: { events: TweetEvent[] }) {
  const stats = useMemo(() => computeTweetDayStats(events), [events]);
  
  if (stats.count === 0) return null;
  
  const isPositive = stats.avgReturn >= 0;
  
  return (
    <div className="flex flex-wrap gap-3 p-4 border-b border-[#30363D]">
      <div className="flex items-center gap-4 px-4 py-3 bg-[#161B22] rounded-lg border border-[#30363D]">
        <div>
          <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">Tweet Days</div>
          <div className="flex items-baseline gap-3">
            <span className={`text-xl font-mono font-semibold ${isPositive ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
              {isPositive ? '+' : ''}{stats.avgReturn}%
            </span>
            <span className="text-sm text-[#8B949E]">avg</span>
          </div>
        </div>
        <div className="w-px h-10 bg-[#30363D]" />
        <div>
          <div className="text-xs text-[#8B949E] uppercase tracking-wide mb-1">Win Rate</div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-mono font-semibold text-[#C9D1D9]">
              {stats.winRate}%
            </span>
            <span className="text-xs text-[#6E7681]">({stats.count} tweets)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DataTable({ events, founder, assetName }: DataTableProps) {
  // Default sort by % 24H descending (show biggest moves first)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'change_24h_pct', desc: true }
  ]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns = useMemo(() => [
    // Date column - compressed, time on hover
    columnHelper.accessor('timestamp', {
      header: 'Date',
      cell: info => {
        const date = new Date(info.getValue() * 1000);
        const dateStr = date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: '2-digit'
        });
        const timeStr = date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false
        });
        return (
          <span 
            className="text-[#8B949E] whitespace-nowrap"
            title={`${dateStr} at ${timeStr}`}
          >
            {dateStr}
          </span>
        );
      },
      sortingFn: 'basic',
    }),
    
    // Tweet column - clickable link with HTML entity decoding
    columnHelper.accessor('text', {
      id: 'tweet',
      header: 'Tweet',
      cell: info => {
        const row = info.row.original;
        const decodedText = decodeHtmlEntities(info.getValue());
        return (
          <a
            href={`https://twitter.com/${founder}/status/${row.tweet_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-[250px] sm:max-w-[300px]"
          >
            <p 
              className="text-sm text-[#C9D1D9] truncate hover:text-[#58A6FF] hover:underline transition-colors" 
              title={decodedText}
            >
              {decodedText}
            </p>
          </a>
        );
      },
      enableSorting: false,
    }),
    
    // Price column - hidden on mobile (% changes are more important)
    columnHelper.accessor('price_at_tweet', {
      header: 'Price',
      cell: info => {
        const price = info.getValue();
        return price ? (
          <span className="font-mono text-[#C9D1D9] text-sm">
            ${price.toFixed(6)}
          </span>
        ) : (
          <span className="text-[#6E7681]">—</span>
        );
      },
      sortingFn: 'basic',
      meta: { hideOnMobile: true },
    }),
    
    // % 1h column - simple colored text
    columnHelper.accessor('change_1h_pct', {
      header: '1H',
      cell: info => {
        const change = info.getValue();
        if (change === null) return <span className="text-[#6E7681]">—</span>;
        const isPositive = change >= 0;
        return (
          <span className={`font-mono text-sm ${isPositive ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </span>
        );
      },
      sortingFn: 'basic',
    }),
    
    // % 24h column - simple colored text, slightly bolder
    columnHelper.accessor('change_24h_pct', {
      header: '24H',
      cell: info => {
        const change = info.getValue();
        if (change === null) return <span className="text-[#6E7681]">—</span>;
        const isPositive = change >= 0;
        return (
          <span className={`font-mono text-sm font-semibold ${isPositive ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </span>
        );
      },
      sortingFn: 'basic',
    }),
    
    // Likes - hidden on mobile
    columnHelper.accessor('likes', {
      header: '❤️',
      cell: info => (
        <span className="text-[#8B949E] text-sm">
          {info.getValue().toLocaleString()}
        </span>
      ),
      sortingFn: 'basic',
      meta: { hideOnMobile: true },
    }),
    
    // Retweets column removed - data still in CSV export
  ], [founder]);

  const table = useReactTable({
    data: events,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="flex flex-col">
      {/* Tweet Day Stats */}
      <TweetDayStats events={events} />
      
      {/* Search & Export */}
      <div className="flex items-center gap-3 p-4 border-b border-[#30363D]">
        <input
          type="text"
          placeholder="Search tweets..."
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="flex-1 px-3 py-2 bg-[#0D1117] border border-[#30363D] rounded-lg text-[#C9D1D9] placeholder-[#6E7681] focus:outline-none focus:border-[#58A6FF] text-sm"
        />
        <button
          onClick={() => exportToCSV(events, founder, assetName)}
          className="px-3 py-2 bg-[#21262D] text-[#C9D1D9] rounded-lg hover:bg-[#30363D] transition-colors text-sm whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      {/* Table with horizontal scroll for mobile */}
      <div className="overflow-x-auto relative" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Scroll indicator fade on right edge */}
        <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-[#0D1117] to-transparent z-20 md:hidden" />
        
        <table className="w-full min-w-[480px]">
          <thead className="sticky top-0 bg-[#161B22] z-10">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, idx) => {
                  const hideOnMobile = (header.column.columnDef.meta as { hideOnMobile?: boolean })?.hideOnMobile;
                  const isFirstCol = idx === 0;
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={`px-3 py-3 text-left text-xs font-medium text-[#8B949E] uppercase tracking-wider border-b border-[#30363D] select-none ${
                        header.column.getCanSort() 
                          ? 'cursor-pointer hover:text-[#C9D1D9] hover:bg-[#21262D] active:bg-[#30363D]' 
                          : ''
                      } ${hideOnMobile ? 'hidden sm:table-cell' : ''} ${
                        isFirstCol ? 'sticky left-0 bg-[#161B22] z-20 md:static' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className={`transition-opacity ${header.column.getIsSorted() ? 'opacity-100' : 'opacity-30'}`}>
                            {header.column.getIsSorted() === 'asc' ? '↑' : header.column.getIsSorted() === 'desc' ? '↓' : '↕'}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[#21262D]">
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-[#161B22]">
                {row.getVisibleCells().map((cell, idx) => {
                  const hideOnMobile = (cell.column.columnDef.meta as { hideOnMobile?: boolean })?.hideOnMobile;
                  const isFirstCol = idx === 0;
                  return (
                    <td 
                      key={cell.id} 
                      className={`px-3 py-3 ${hideOnMobile ? 'hidden sm:table-cell' : ''} ${
                        isFirstCol ? 'sticky left-0 bg-[#0D1117] md:static' : ''
                      }`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="p-4 border-t border-[#30363D] bg-[#161B22]">
        <div className="flex items-center justify-between text-sm text-[#8B949E]">
          <span>
            Showing {table.getFilteredRowModel().rows.length} of {events.length} tweets
          </span>
          <span className="hidden sm:inline">
            {events.filter(e => e.price_at_tweet !== null).length} with price data
          </span>
        </div>
      </div>
    </div>
  );
}

function exportToCSV(events: TweetEvent[], founder: string, assetName: string) {
  const headers = [
    'Date',
    'Tweet',
    'Price at Tweet',
    'Price +1h',
    'Price +24h',
    'Change 1h %',
    'Change 24h %',
    'Likes',
    'Retweets',
    'Tweet URL'
  ];

  const rows = events.map(e => [
    new Date(e.timestamp * 1000).toISOString(),
    `"${e.text.replace(/"/g, '""')}"`,
    e.price_at_tweet?.toFixed(8) ?? '',
    e.price_1h?.toFixed(8) ?? '',
    e.price_24h?.toFixed(8) ?? '',
    e.change_1h_pct?.toFixed(2) ?? '',
    e.change_24h_pct?.toFixed(2) ?? '',
    e.likes,
    e.retweets,
    `https://twitter.com/${founder}/status/${e.tweet_id}`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${assetName.toLowerCase()}_tweet_data.csv`;
  a.click();

  URL.revokeObjectURL(url);
}
