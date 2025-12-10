/**
 * Price Service - Fetch exchange rates from CoinGecko API
 */

interface CoinGeckoPriceResponse {
  [coinId: string]: {
    usd: number;
  };
}

interface PriceCache {
  rate: number;
  timestamp: number;
}

// CoinGecko coin IDs
const COIN_IDS: Record<string, string> = {
  USDC: 'usd-coin',
  EURC: 'euro-coin',
};

// Cache tỉ giá trong 60 giây
const CACHE_TTL = 60 * 1000; // 60 seconds
const priceCache: Map<string, PriceCache> = new Map();

/**
 * Get exchange rate from CoinGecko
 * @param fromCurrency - Currency code (e.g., "USDC")
 * @param toCurrency - Currency code (e.g., "EURC")
 * @returns Exchange rate
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  const cacheKey = `${fromCurrency}_${toCurrency}`;
  const cached = priceCache.get(cacheKey);

  // Return cached rate if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📊 Using cached rate: ${fromCurrency} → ${toCurrency} = ${cached.rate}`);
    return cached.rate;
  }

  try {
    const fromCoinId = COIN_IDS[fromCurrency];
    const toCoinId = COIN_IDS[toCurrency];

    if (!fromCoinId || !toCoinId) {
      console.warn(`⚠️  Coin ID not found for ${fromCurrency} or ${toCurrency}, using default rate 1.0`);
      return 1.0;
    }

    // Fetch prices from CoinGecko
    const apiKey = process.env.COINGECKO_API_KEY;
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${fromCoinId},${toCoinId}&vs_currencies=usd${apiKey ? `&x_cg_pro_api_key=${apiKey}` : ''}`;
    
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['x-cg-pro-api-key'] = apiKey;
    }
    
    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoPriceResponse;

    const fromPrice = data[fromCoinId]?.usd;
    const toPrice = data[toCoinId]?.usd;

    if (!fromPrice || !toPrice) {
      throw new Error('Price data not available');
    }

    // Calculate exchange rate: fromCurrency/toCurrency = (fromPrice/USD) / (toPrice/USD)
    const rate = fromPrice / toPrice;

    // Cache the rate
    priceCache.set(cacheKey, {
      rate,
      timestamp: Date.now(),
    });

    console.log(`📊 Fetched rate from CoinGecko: ${fromCurrency} → ${toCurrency} = ${rate}`);
    return rate;
  } catch (error: any) {
    console.error(`❌ Error fetching rate from CoinGecko: ${error.message}`);

    // Không fallback sang rate cứng nữa.
    // Nếu trong cache còn giá cũ thì dùng lại giá đó, tránh nhảy loạn.
    const cached = priceCache.get(cacheKey);
    if (cached) {
      console.log(`🔁 Using last cached rate for ${fromCurrency} → ${toCurrency}: ${cached.rate}`);
      return cached.rate;
    }

    // Nếu chưa từng có giá, throw để caller tự xử lý (chart có thể hiển thị phẳng hoặc trống).
    throw error;
  }
}

export interface HistoricalRatePoint {
  time: number; // seconds since epoch
  rate: number;
}

/**
 * Get historical exchange rates (from today / recent days) from CoinGecko
 * Trả về list tick { time (sec), rate } để backend tự build nến.
 */
export async function getHistoricalRates(
  fromCurrency: string,
  toCurrency: string,
  days: string = '1',
  interval: string = 'auto',
): Promise<HistoricalRatePoint[]> {
  const fromCoinId = COIN_IDS[fromCurrency];
  const toCoinId = COIN_IDS[toCurrency];

  if (!fromCoinId || !toCoinId) {
    console.warn(`⚠️  Coin ID not found for ${fromCurrency} or ${toCurrency}, skip historical fetch`);
    return [];
  }

  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const intervalParam = !interval || interval === 'auto' ? '' : `&interval=${interval}`;
    const baseUrl = 'https://api.coingecko.com/api/v3/coins';

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['x-cg-pro-api-key'] = apiKey;
    }

    // Fetch both coins vs USD
    const [fromResponse, toResponse] = await Promise.all([
      fetch(`${baseUrl}/${fromCoinId}/market_chart?vs_currency=usd&days=${days}${intervalParam}${apiKey ? `&x_cg_pro_api_key=${apiKey}` : ''}`, { headers }),
      fetch(`${baseUrl}/${toCoinId}/market_chart?vs_currency=usd&days=${days}${intervalParam}${apiKey ? `&x_cg_pro_api_key=${apiKey}` : ''}`, { headers }),
    ]);

    if (!fromResponse.ok || !toResponse.ok) {
      throw new Error(`CoinGecko market_chart error: ${fromResponse.status} or ${toResponse.status}`);
    }

    const fromData: any = await fromResponse.json();
    const toData: any = await toResponse.json();

    const prices = fromData.prices || [];
    const toPrices = toData.prices || [];

    const toPriceMap = new Map<number, number>(toPrices.map(([time, price]: [number, number]) => [time, price]));

    const points: HistoricalRatePoint[] = [];

    for (const [timestamp, fromPrice] of prices as [number, number][]) {
      const toPrice = toPriceMap.get(timestamp);
      if (!toPrice || typeof fromPrice !== 'number' || typeof toPrice !== 'number') continue;

      const rate = fromPrice / toPrice;
      points.push({
        time: Math.floor(timestamp / 1000), // ms -> sec
        rate,
      });
    }

    return points;
  } catch (error: any) {
    console.error(`❌ Error fetching historical rates from CoinGecko: ${error.message}`);
    return [];
  }
}

/**
 * Clear price cache (useful for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
  console.log('🗑️  Price cache cleared');
}

