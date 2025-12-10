import { RFQRequest, Quote } from '../types';

// In-memory storage (sẽ thay bằng database sau)
const rfqStore: Map<string, RFQRequest & { id: string; createdAt: number }> = new Map();
const quoteStore: Map<string, Quote[]> = new Map();

export class RFQService {
  /**
   * Tạo RFQ request mới
   */
  static createRFQ(rfq: RFQRequest): string {
    const rfqId = `rfq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    rfqStore.set(rfqId, {
      ...rfq,
      id: rfqId,
      createdAt: Date.now(),
    });

    // Initialize quotes array
    quoteStore.set(rfqId, []);

    console.log(`📝 RFQ created: ${rfqId}`, rfq);
    
    return rfqId;
  }

  /**
   * Lấy RFQ by ID
   */
  static getRFQ(rfqId: string) {
    return rfqStore.get(rfqId);
  }

  /**
   * Broadcast RFQ đến makers (trong thực tế sẽ gửi đến maker service)
   */
  static broadcastRFQ(rfqId: string): void {
    const rfq = rfqStore.get(rfqId);
    if (!rfq) {
      throw new Error('RFQ not found');
    }

    // TODO: Gửi đến maker service để request quotes
    console.log(`📢 Broadcasting RFQ ${rfqId} to makers...`);
    
    // Simulate: Maker service sẽ tự động provide quote
    // Trong thực tế, sẽ có webhook hoặc message queue
  }

  /**
   * Add quote từ maker
   */
  static addQuote(rfqId: string, quote: Omit<Quote, 'id' | 'rfqId'>): string {
    const quotes = quoteStore.get(rfqId) || [];
    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newQuote: Quote = {
      ...quote,
      id: quoteId,
      rfqId,
    };

    quotes.push(newQuote);
    quoteStore.set(rfqId, quotes);

    console.log(`💬 Quote added: ${quoteId} for RFQ ${rfqId}`);
    
    return quoteId;
  }

  /**
   * Lấy tất cả quotes cho RFQ
   */
  static getQuotes(rfqId: string): Quote[] {
    return quoteStore.get(rfqId) || [];
  }

  /**
   * Lấy best quote (highest toAmount)
   */
  static getBestQuote(rfqId: string): Quote | null {
    const quotes = quoteStore.get(rfqId) || [];
    if (quotes.length === 0) return null;

    // Sort by toAmount descending
    const sorted = [...quotes].sort((a, b) => 
      parseFloat(b.toAmount) - parseFloat(a.toAmount)
    );

    return sorted[0];
  }

  /**
   * Lấy tất cả RFQs chưa có quotes hoặc có thể nhận quotes mới (cho BOT)
   */
  static getPendingRFQs(): Array<RFQRequest & { id: string; createdAt: number }> {
    const pendingRFQs: Array<RFQRequest & { id: string; createdAt: number }> = [];
    const now = Date.now();

    rfqStore.forEach((rfq) => {
      // RFQ còn valid (không quá cũ, ví dụ 5 phút)
      const age = now - rfq.createdAt;
      if (age > 5 * 60 * 1000) return; // Skip RFQ quá 5 phút

      // Có thể có quotes mới hoặc chưa có quotes
      const quotes = quoteStore.get(rfq.id) || [];
      if (quotes.length < 10) { // Limit số quotes tối đa
        pendingRFQs.push(rfq);
      }
    });

    return pendingRFQs.sort((a, b) => b.createdAt - a.createdAt); // Mới nhất trước
  }
}

