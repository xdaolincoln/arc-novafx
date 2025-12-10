import { RFQRequest, Quote } from '../types';
import { RFQService } from './rfq.service';
import { getExchangeRate } from './price.service';

/**
 * Maker Service - Tự động provide quotes
 * Trong thực tế, đây sẽ là service riêng hoặc được gọi từ maker backend
 */
export class MakerService {
  // Fallback rates (chỉ dùng khi CoinGecko API fail)
  private static fallbackRates: Record<string, Record<string, number>> = {
    USDC: {
      EURC: 0.92, // 1 USDC = 0.92 EURC (fallback)
    },
    EURC: {
      USDC: 1.087, // 1 EURC = 1.087 USDC (fallback)
    },
  };

  /**
   * Provide quote tự động khi có RFQ
   */
  static async provideQuote(rfqId: string, makerAddress: string): Promise<string> {
    const rfq = RFQService.getRFQ(rfqId);
    if (!rfq) {
      throw new Error('RFQ not found');
    }

    // Get exchange rate from CoinGecko API (with fallback)
    const rate = await getExchangeRate(rfq.from.currency, rfq.to.currency);
    const fromAmount = parseFloat(rfq.from.amount);
    const toAmount = fromAmount * rate;

    // Create quote
    const quote: Omit<Quote, 'id' | 'rfqId'> = {
      makerAddress,
      fromCurrency: rfq.from.currency,
      toCurrency: rfq.to.currency,
      fromAmount: rfq.from.amount,
      toAmount: toAmount.toFixed(6),
      rate,
      expiry: Math.floor(Date.now() / 1000) + 300, // 5 minutes expiry
    };

    const quoteId = RFQService.addQuote(rfqId, quote);

    console.log(`🤖 Maker ${makerAddress} provided quote ${quoteId} for RFQ ${rfqId}`);

    return quoteId;
  }

  /**
   * Get fallback rate (chỉ dùng khi CoinGecko API fail)
   */
  private static getFallbackRate(from: string, to: string): number {
    return this.fallbackRates[from]?.[to] || 1.0;
  }
}

