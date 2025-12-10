import { Router } from 'express';
import { PriceCandleService, Timeframe } from '../services/candle.service';

export const candleRoutes = Router();

const VALID_TIMEFRAMES: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * GET /api/candles/:pair
 * Query: tf=5m|15m|30m|1h|4h|1d, limit=number
 * Hiện tại chỉ hỗ trợ pair USDC-EURC
 */
candleRoutes.get('/:pair', (req, res) => {
  try {
    const { pair } = req.params;
    const { tf = '1h', limit = '200' } = req.query;

    if (pair !== 'USDC-EURC') {
      return res.status(400).json({ error: 'Only USDC-EURC pair is supported for now' });
    }

    const timeframe = String(tf) as Timeframe;
    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return res.status(400).json({ error: `Invalid timeframe, expected one of: ${VALID_TIMEFRAMES.join(', ')}` });
    }

    const limitNum = Number(limit) || 200;
    const candles = PriceCandleService.getCandles(timeframe, limitNum);

    res.json({
      success: true,
      pair,
      timeframe,
      data: candles,
    });
  } catch (error: any) {
    console.error('Error in /api/candles:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});


