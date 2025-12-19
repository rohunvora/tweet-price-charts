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

export default function DataTable({ events, founder, assetName }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timestamp', desc: true }
  ]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns = useMemo(() => [
    columnHelper.accessor('timestamp', {
      header: 'Date',
      cell: info => {
        const date = new Date(info.getValue() * 1000);
        return (
          <span className="text-[#8B949E] whitespace-nowrap">
            {date.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              year: '2-digit'
            })}
            <span className="text-[#6E7681] ml-1">
              {date.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false
              })}
            </span>
          </span>
        );
      },
      sortingFn: 'basic',
    }),
    columnHelper.accessor('text', {
      header: 'Tweet',
      cell: info => (
        <div className="max-w-[300px]">
          <p className="text-sm text-[#C9D1D9] truncate" title={info.getValue()}>
            {info.getValue()}
          </p>
        </div>
      ),
    }),
    columnHelper.accessor('price_at_tweet', {
      header: 'Price @ Tweet',
      cell: info => {
        const price = info.getValue();
        return price ? (
          <span className="font-mono text-[#C9D1D9]">
            ${price.toFixed(6)}
          </span>
        ) : (
          <span className="text-[#6E7681]">—</span>
        );
      },
      sortingFn: 'basic',
    }),
    columnHelper.accessor('price_1h', {
      header: '+1h',
      cell: info => {
        const price = info.getValue();
        return price ? (
          <span className="font-mono text-[#8B949E]">
            ${price.toFixed(6)}
          </span>
        ) : (
          <span className="text-[#6E7681]">—</span>
        );
      },
      sortingFn: 'basic',
    }),
    columnHelper.accessor('change_1h_pct', {
      header: '% 1h',
      cell: info => {
        const change = info.getValue();
        if (change === null) return <span className="text-[#6E7681]">—</span>;
        const isPositive = change >= 0;
        return (
          <span className={`font-mono ${isPositive ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </span>
        );
      },
      sortingFn: 'basic',
    }),
    columnHelper.accessor('change_24h_pct', {
      header: '% 24h',
      cell: info => {
        const change = info.getValue();
        if (change === null) return <span className="text-[#6E7681]">—</span>;
        const isPositive = change >= 0;
        return (
          <span className={`font-mono font-semibold ${isPositive ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </span>
        );
      },
      sortingFn: 'basic',
    }),
    columnHelper.accessor('likes', {
      header: '❤️',
      cell: info => (
        <span className="text-[#8B949E]">
          {info.getValue().toLocaleString()}
        </span>
      ),
      sortingFn: 'basic',
    }),
    columnHelper.accessor('retweets', {
      header: '🔁',
      cell: info => (
        <span className="text-[#8B949E]">
          {info.getValue().toLocaleString()}
        </span>
      ),
      sortingFn: 'basic',
    }),
    columnHelper.accessor('tweet_id', {
      header: '',
      cell: info => (
        <a
          href={`https://twitter.com/${founder}/status/${info.getValue()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#58A6FF] hover:underline text-sm"
        >
          View
        </a>
      ),
      enableSorting: false,
    }),
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
    <div className="flex flex-col h-full">
      {/* Search & Export */}
      <div className="flex items-center gap-4 p-4 border-b border-[#30363D]">
        <input
          type="text"
          placeholder="Search tweets..."
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="flex-1 px-3 py-2 bg-[#0D1117] border border-[#30363D] rounded-lg text-[#C9D1D9] placeholder-[#6E7681] focus:outline-none focus:border-[#58A6FF]"
        />
        <button
          onClick={() => exportToCSV(events, founder, assetName)}
          className="px-4 py-2 bg-[#21262D] text-[#C9D1D9] rounded-lg hover:bg-[#30363D] transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-[#161B22] z-10">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`px-4 py-3 text-left text-xs font-medium text-[#8B949E] uppercase tracking-wider border-b border-[#30363D] ${
                      header.column.getCanSort() ? 'cursor-pointer hover:text-[#C9D1D9]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() && (
                        <span>{header.column.getIsSorted() === 'asc' ? ' ↑' : ' ↓'}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[#21262D]">
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-[#161B22]">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
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
          <span>
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

