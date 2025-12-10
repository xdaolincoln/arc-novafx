import { Router } from 'express';
import { getExchangeRate } from '../services/price.service';
// Dynamic import kiểu CommonJS để tránh issues về type exports
// (module này chủ yếu chạy runtime, không ảnh hưởng đến API)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const priceService = require('../services/price.service');

export const priceRoutes = Router();

// CoinGecko coin IDs
const COIN_IDS: Record<string, string> = {
  USDC: 'usd-coin',
  EURC: 'euro-coin',
};

/**
 * GET /api/price/:fromCurrency/:toCurrency
 * Lấy tỷ giá từ CoinGecko
 */
priceRoutes.get('/:fromCurrency/:toCurrency', async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = req.params;

    if (!fromCurrency || !toCurrency) {
      return res.status(400).json({ error: 'fromCurrency and toCurrency required' });
    }

    const rate = await getExchangeRate(fromCurrency.toUpperCase(), toCurrency.toUpperCase());

    res.json({
      success: true,
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: toCurrency.toUpperCase(),
      rate,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('Error fetching price:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/price/:fromCurrency/:toCurrency/history
 * Lấy historical price data từ CoinGecko cho chart
 * Query params: days (số ngày), interval (1h, 4h, 1d)
 */
priceRoutes.get('/:fromCurrency/:toCurrency/history', async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = req.params;
    const { days = '7', interval = 'hourly' } = req.query;

    const intervalStr = typeof interval === 'string' ? interval : String(interval);

    if (!fromCurrency || !toCurrency) {
      return res.status(400).json({ error: 'fromCurrency and toCurrency required' });
    }

    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    const chartData = await priceService.getHistoricalRates(from, to, String(days), intervalStr);

    res.json({
      success: true,
      fromCurrency: from,
      toCurrency: to,
      data: chartData,
    });
  } catch (error: any) {
    console.error('Error fetching historical price:', error);
    res.status(500).json({ error: error.message });
  }
});

