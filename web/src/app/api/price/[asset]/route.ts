import { NextRequest, NextResponse } from 'next/server';

// =============================================================================
// Live Price API Endpoint
// =============================================================================
// Fetches current price for an asset from the appropriate data source.
// Designed to be called at 1-minute intervals for real-time updates.
//
// Returns: { price: number, timestamp: number, source: string }
// =============================================================================

// Asset configuration (subset of scripts/assets.json needed for price fetching)
const ASSETS: Record<string, {
  name: string;
  price_source: 'geckoterminal' | 'hyperliquid' | 'coingecko';
  network?: string;
  pool_address?: string;
  coingecko_id?: string;
}> = {
  pump: {
    name: 'PUMP',
    price_source: 'geckoterminal',
    network: 'solana',
    pool_address: '2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd',
  },
  hype: {
    name: 'HYPE',
    price_source: 'hyperliquid',
  },
  aster: {
    name: 'ASTER',
    price_source: 'geckoterminal',
    network: 'bsc',
    pool_address: '0x7e58f160b5b77b8b24cd9900c09a3e730215ac47',
  },
  believe: {
    name: 'LAUNCHCOIN',
    price_source: 'geckoterminal',
    network: 'solana',
    pool_address: 'YrrUStgPugDp8BbfosqDeFssen6sA75ZS1QJvgnHtmY',
  },
  jup: {
    name: 'JUP',
    price_source: 'geckoterminal',
    network: 'solana',
    pool_address: 'C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz',
  },
  monad: {
    name: 'MON',
    price_source: 'geckoterminal',
    network: 'monad',
    pool_address: '0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954',
  },
  useless: {
    name: 'USELESS',
    price_source: 'geckoterminal',
    network: 'solana',
    pool_address: 'Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp',
  },
  pengu: {
    name: 'PENGU',
    price_source: 'coingecko',
    coingecko_id: 'pudgy-penguins',
  },
};

// Response type
interface PriceResponse {
  price: number;
  timestamp: number;
  source: string;
  asset: string;
}

// =============================================================================
// Price Fetching Functions
// =============================================================================

async function fetchFromGeckoTerminal(network: string, poolAddress: string): Promise<number | null> {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 30 }, // Cache for 30 seconds on Vercel edge
    });

    if (!response.ok) {
      console.error(`[GeckoTerminal] Failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const priceUsd = data?.data?.attributes?.base_token_price_usd;

    if (priceUsd) {
      return parseFloat(priceUsd);
    }
    return null;
  } catch (error) {
    console.error('[GeckoTerminal] Error:', error);
    return null;
  }
}

async function fetchFromHyperliquid(): Promise<number | null> {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'spotMeta' }),
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      console.error(`[Hyperliquid] Failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Find HYPE token in spot tokens
    const tokens = data?.tokens || [];
    const hypeToken = tokens.find((t: { name: string }) => t.name === 'HYPE');

    if (hypeToken?.markPx) {
      return parseFloat(hypeToken.markPx);
    }

    // Fallback: try spot clearinghouse state for market price
    const marketResponse = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });

    if (marketResponse.ok) {
      const marketData = await marketResponse.json();
      // HYPE is traded as HYPE/USDC on spot
      if (marketData?.HYPE) {
        return parseFloat(marketData.HYPE);
      }
    }

    return null;
  } catch (error) {
    console.error('[Hyperliquid] Error:', error);
    return null;
  }
}

async function fetchFromCoinGecko(coingeckoId: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 60 }, // CoinGecko free tier has stricter limits
    });

    if (!response.ok) {
      console.error(`[CoinGecko] Failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.[coingeckoId]?.usd ?? null;
  } catch (error) {
    console.error('[CoinGecko] Error:', error);
    return null;
  }
}

// =============================================================================
// Route Handler
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asset: string }> }
): Promise<NextResponse<PriceResponse | { error: string }>> {
  const { asset } = await params;
  const assetConfig = ASSETS[asset.toLowerCase()];

  if (!assetConfig) {
    return NextResponse.json(
      { error: `Unknown asset: ${asset}` },
      { status: 404 }
    );
  }

  let price: number | null = null;
  let source = assetConfig.price_source;

  // Fetch price based on configured source
  switch (assetConfig.price_source) {
    case 'geckoterminal':
      if (assetConfig.network && assetConfig.pool_address) {
        price = await fetchFromGeckoTerminal(assetConfig.network, assetConfig.pool_address);
      }
      break;

    case 'hyperliquid':
      price = await fetchFromHyperliquid();
      break;

    case 'coingecko':
      if (assetConfig.coingecko_id) {
        price = await fetchFromCoinGecko(assetConfig.coingecko_id);
      }
      break;
  }

  if (price === null) {
    return NextResponse.json(
      { error: `Failed to fetch price for ${asset}` },
      { status: 502 }
    );
  }

  const response: PriceResponse = {
    price,
    timestamp: Math.floor(Date.now() / 1000),
    source,
    asset: asset.toLowerCase(),
  };

  // Set cache headers for CDN
  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
}

// Enable Edge Runtime for faster response times
export const runtime = 'edge';
