import { getExchangeRate } from './price.service';

export type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface Candle {
  time: number; // bucket start time in seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
};

// In-memory candle store cho cặp USDC/EURC
const candleStore: Record<Timeframe, Candle[]> = {
  '5m': [],
  '15m': [],
  '30m': [],
  '1h': [],
  '4h': [],
  '1d': [],
};

const MAX_CANDLES = 200;

export class PriceCandleService {
  private static started = false;

  static start() {
    if (this.started) return;
    this.started = true;
    console.log('📈 PriceCandleService started');

    // Tick ngay lập tức và sau đó mỗi 5 phút
    this.tick();
    setInterval(() => {
      this.tick().catch((err) => {
        console.error('❌ PriceCandleService tick error:', err);
      });
    }, 5 * 60_000);
  }

  private static async tick() {
    try {
      const rate = await getExchangeRate('USDC', 'EURC');
      const now = Math.floor(Date.now() / 1000);

      (Object.keys(TIMEFRAME_SECONDS) as Timeframe[]).forEach((tf) => {
        this.updateCandle(tf, now, rate);
      });
    } catch (error: any) {
      console.error('❌ Error in PriceCandleService.tick:', error?.message || error);
    }
  }

  private static updateCandle(timeframe: Timeframe, timestamp: number, rate: number) {
    const tfSeconds = TIMEFRAME_SECONDS[timeframe];
    const bucketStart = Math.floor(timestamp / tfSeconds) * tfSeconds;

    const candles = candleStore[timeframe];
    const last = candles[candles.length - 1];

    if (!last || last.time !== bucketStart) {
      // Tạo candle mới
      const candle: Candle = {
        time: bucketStart,
        open: rate,
        high: rate,
        low: rate,
        close: rate,
      };
      candles.push(candle);

      // Giữ tối đa MAX_CANDLES
      if (candles.length > MAX_CANDLES) {
        candles.splice(0, candles.length - MAX_CANDLES);
      }
    } else {
      // Cập nhật candle hiện tại
      last.high = Math.max(last.high, rate);
      last.low = Math.min(last.low, rate);
      last.close = rate;
    }
  }

  static getCandles(timeframe: Timeframe, limit: number = 200): Candle[] {
    const candles = candleStore[timeframe] || [];
    if (limit <= 0) return candles;
    return candles.slice(-limit);
  }
}


