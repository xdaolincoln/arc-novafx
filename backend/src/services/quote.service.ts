import { Quote, RFQRequest } from '../types';
import { RFQService } from './rfq.service';

export class QuoteService {
  /**
   * Calculate settlement time dựa trên tenor
   */
  static calculateSettlementTime(tenor: 'instant' | 'hourly' | 'daily'): number {
    const now = Math.floor(Date.now() / 1000);
    const schedules = {
      instant: 2 * 60, // 2 minutes (để test nhanh hơn, có thể tăng lại sau)
      hourly: 60 * 60,  // 1 hour
      daily: 24 * 60 * 60, // 1 day
    };

    return now + schedules[tenor];
  }

  /**
   * Validate quote
   */
  static validateQuote(quote: Quote, rfq: RFQRequest): boolean {
    // Check expiry
    if (Date.now() / 1000 > quote.expiry) {
      return false;
    }

    // Check currency match
    if (quote.fromCurrency !== rfq.from.currency || quote.toCurrency !== rfq.to.currency) {
      return false;
    }

    // Check amount match
    if (quote.fromAmount !== rfq.from.amount) {
      return false;
    }

    return true;
  }

  /**
   * Select best quote và mark as selected
   */
  static selectBestQuote(rfqId: string): Quote | null {
    const bestQuote = RFQService.getBestQuote(rfqId);
    if (!bestQuote) return null;

    // Mark as selected
    const quotes = RFQService.getQuotes(rfqId);
    const updated = quotes.map(q => 
      q.id === bestQuote.id ? { ...q, selected: true } : { ...q, selected: false }
    );
    
    // Update store (trong thực tế sẽ update database)
    bestQuote.selected = true;

    return bestQuote;
  }
}

