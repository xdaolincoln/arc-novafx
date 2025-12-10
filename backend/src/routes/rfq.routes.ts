import { Router } from 'express';
import { RFQService } from '../services/rfq.service';
import { RFQRequest } from '../types';

export const rfqRoutes = Router();

/**
 * POST /api/rfq
 * Tạo RFQ request mới
 */
rfqRoutes.post('/', async (req, res) => {
  try {
    const rfq: RFQRequest = req.body;

    // Validate
    if (!rfq.from?.currency || !rfq.from?.amount || !rfq.to?.currency || !rfq.tenor) {
      return res.status(400).json({ error: 'Invalid RFQ request' });
    }

    // Validate restrictions
    // Rule: USDC → EURC hạn chế < 10 USDC
    if (rfq.from.currency === 'USDC' && rfq.to.currency === 'EURC') {
      const amount = parseFloat(rfq.from.amount);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
      if (amount >= 10) {
        return res.status(400).json({ 
          error: 'USDC to EURC trades are limited to less than 10 USDC. Please enter an amount less than 10.' 
        });
      }
    }

    // Create RFQ
    const rfqId = RFQService.createRFQ(rfq);

    // Broadcast to makers (BOTs will pick up via /api/rfq/pending endpoint)
    RFQService.broadcastRFQ(rfqId);

    // Note: Maker BOTs sẽ tự động provide quotes via polling /api/rfq/pending
    // Không cần simulate quote nữa

    res.json({
      success: true,
      rfqId,
      message: 'RFQ created successfully',
    });
  } catch (error: any) {
    console.error('Error creating RFQ:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/rfq/:rfqId
 * Lấy RFQ by ID
 */
/**
 * GET /api/rfq/pending
 * Lấy RFQs chưa có quotes (cho BOT)
 */
rfqRoutes.get('/pending', (req, res) => {
  try {
    const pendingRFQs = RFQService.getPendingRFQs();

    res.json({
      success: true,
      rfqs: pendingRFQs,
      count: pendingRFQs.length,
    });
  } catch (error: any) {
    console.error('Error getting pending RFQs:', error);
    res.status(500).json({ error: error.message });
  }
});

rfqRoutes.get('/:rfqId', (req, res) => {
  try {
    const { rfqId } = req.params;
    const rfq = RFQService.getRFQ(rfqId);

    if (!rfq) {
      return res.status(404).json({ error: 'RFQ not found' });
    }

    res.json({
      success: true,
      rfq,
    });
  } catch (error: any) {
    console.error('Error getting RFQ:', error);
    res.status(500).json({ error: error.message });
  }
});

