import { Router } from 'express';
import { RFQService } from '../services/rfq.service';
import { QuoteService } from '../services/quote.service';
import { SettlementService } from '../services/settlement.service';
import { MakerService } from '../services/maker.service';

export const quoteRoutes = Router();

/**
 * GET /api/quotes/:rfqId
 * Lấy tất cả quotes cho RFQ
 */
quoteRoutes.get('/:rfqId', (req, res) => {
  try {
    const { rfqId } = req.params;
    const quotes = RFQService.getQuotes(rfqId);
    const bestQuote = RFQService.getBestQuote(rfqId);

    res.json({
      success: true,
      quotes,
      bestQuote,
      count: quotes.length,
    });
  } catch (error: any) {
    console.error('Error getting quotes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/quotes/:rfqId/accept
 * Accept quote và tạo trade
 * Body: { quoteId, takerAddress, takerSig }
 */
quoteRoutes.post('/:rfqId/accept', async (req, res) => {
  try {
    const { rfqId } = req.params;
    const { quoteId, takerAddress, takerSig, settlementTime } = req.body;

    if (!quoteId || !takerAddress || !takerSig) {
      return res.status(400).json({ error: 'quoteId, takerAddress, and takerSig required' });
    }

    if (!takerSig.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid takerSig format (must start with 0x)' });
    }

    // Validate settlementTime if provided (frontend can send it to ensure consistency)
    if (settlementTime && (typeof settlementTime !== 'number' || settlementTime <= 0)) {
      return res.status(400).json({ error: 'Invalid settlementTime format' });
    }

    // Get quote
    const quotes = RFQService.getQuotes(rfqId);
    const quote = quotes.find(q => q.id === quoteId);

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Select best quote
    QuoteService.selectBestQuote(rfqId);

    // Get RFQ to get tenor
    const rfq = RFQService.getRFQ(rfqId);
    if (!rfq) {
      return res.status(404).json({ error: 'RFQ not found' });
    }

    // Use settlementTime from frontend if provided (to ensure consistency), otherwise calculate from tenor
    const finalSettlementTime = settlementTime || QuoteService.calculateSettlementTime(rfq.tenor);
    console.log('⏰ Using settlementTime:', finalSettlementTime, 'from frontend:', !!settlementTime);

    // Create trade on smart contract (takerSig is signed by frontend wallet)
    const trade = await SettlementService.createTrade(rfqId, quote, takerAddress, takerSig, rfq.tenor, finalSettlementTime);

    res.json({
      success: true,
      trade,
      message: 'Quote accepted, trade created',
    });
  } catch (error: any) {
    console.error('Error accepting quote:', error);
    // Ensure error is always a string
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * POST /api/quotes
 * Maker submit quote (alternative endpoint)
 */
quoteRoutes.post('/', async (req, res) => {
  try {
    const { rfqId, makerAddress } = req.body;

    if (!rfqId || !makerAddress) {
      return res.status(400).json({ error: 'rfqId and makerAddress required' });
    }

    const quoteId = await MakerService.provideQuote(rfqId, makerAddress);

    res.json({
      success: true,
      quoteId,
      message: 'Quote submitted successfully',
    });
  } catch (error: any) {
    console.error('Error submitting quote:', error);
    res.status(500).json({ error: error.message });
  }
});

