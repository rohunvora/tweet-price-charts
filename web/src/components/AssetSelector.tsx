'use client';

import { useState, useRef, useEffect } from 'react';
import { Asset } from '@/lib/types';

interface AssetSelectorProps {
  assets: Asset[];
  selectedAsset: Asset;
  onSelect: (asset: Asset) => void;
}

/**
 * Dropdown selector for switching between assets.
 * Shows asset color, ticker, and network badge.
 */
export default function AssetSelector({ assets, selectedAsset, onSelect }: AssetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      setIsOpen(!isOpen);
    } else if (e.key === 'ArrowDown' && isOpen) {
      e.preventDefault();
      const currentIndex = assets.findIndex(a => a.id === selectedAsset.id);
      const nextIndex = (currentIndex + 1) % assets.length;
      onSelect(assets[nextIndex]);
    } else if (e.key === 'ArrowUp' && isOpen) {
      e.preventDefault();
      const currentIndex = assets.findIndex(a => a.id === selectedAsset.id);
      const prevIndex = currentIndex === 0 ? assets.length - 1 : currentIndex - 1;
      onSelect(assets[prevIndex]);
    }
  };

  const handleSelect = (asset: Asset) => {
    console.log(`[AssetSelector] Selected asset: ${asset.id}`);
    onSelect(asset);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Selected asset button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#2A2E39] hover:bg-[#363A45] rounded transition-colors"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {/* Color dot */}
        <span
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: selectedAsset.color }}
        />
        
        {/* Asset name */}
        <span className="text-[#D1D4DC] font-medium">${selectedAsset.name}</span>
        
        {/* Network badge */}
        {selectedAsset.network && (
          <span className="text-[10px] px-1.5 py-0.5 bg-[#1E222D] text-[#787B86] rounded uppercase">
            {selectedAsset.network}
          </span>
        )}
        
        {/* Dropdown arrow */}
        <svg
          className={`w-4 h-4 text-[#787B86] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-64 bg-[#1E222D] border border-[#2A2E39] rounded-lg shadow-xl z-50 overflow-hidden"
          role="listbox"
        >
          {assets.map(asset => (
            <button
              key={asset.id}
              onClick={() => handleSelect(asset)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                asset.id === selectedAsset.id
                  ? 'bg-[#2A2E39]'
                  : 'hover:bg-[#252930]'
              }`}
              role="option"
              aria-selected={asset.id === selectedAsset.id}
            >
              {/* Color dot */}
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: asset.color }}
              />
              
              {/* Asset info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[#D1D4DC] font-medium">${asset.name}</span>
                  {asset.network && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-[#131722] text-[#787B86] rounded uppercase">
                      {asset.network}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#787B86]">
                  @{asset.founder}
                </div>
              </div>
              
              {/* Checkmark for selected */}
              {asset.id === selectedAsset.id && (
                <svg className="w-4 h-4 text-[#2962FF]" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


