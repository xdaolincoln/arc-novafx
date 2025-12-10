import { Router } from 'express';
import { SettlementService } from '../services/settlement.service';
import { ContractService } from '../services/contract.service';
import { formatUnits } from 'viem';

export const settlementRoutes = Router();

/**
 * GET /api/settlement/trade/:tradeId
 * Lấy trade by ID
 */
settlementRoutes.get('/trade/:tradeId', async (req, res) => {
  try {
    const { tradeId } = req.params;
    
    // Extract on-chain tradeId
    const onChainTradeId = BigInt(tradeId.replace('trade_', ''));
    
    // Read from contract
    const tradeData = await ContractService.getTrade(onChainTradeId);
    if (!tradeData) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    
    // Convert contract data to Trade format
    const tradeArray = tradeData as any;
    const taker = tradeArray[0] as string;
    const maker = tradeArray[1] as string;
    const fromToken = tradeArray[2] as string;
    const toToken = tradeArray[3] as string;
    const fromAmount = tradeArray[4] as bigint;
    const toAmount = tradeArray[5] as bigint;
    const settlementTime = Number(tradeArray[6] as bigint);
    const state = tradeArray[8] as number;
    
    const fromCurrency = fromToken.toLowerCase() === '0x3600000000000000000000000000000000000000' ? 'USDC' : 'EURC';
    const toCurrency = toToken.toLowerCase() === '0x3600000000000000000000000000000000000000' ? 'USDC' : 'EURC';
    
    let status: 'pending' | 'funded' | 'settled' | 'failed' = 'pending';
    if (state === 4) status = 'settled';
    else if (state === 3) status = 'funded';
    else if (state >= 1) status = 'funded';
    
    const trade = {
      id: tradeId,
      rfqId: '',
      quoteId: '',
      takerAddress: taker,
      makerAddress: maker,
      fromToken: fromCurrency,
      toToken: toCurrency,
      fromAmount: formatUnits(fromAmount, 6),
      toAmount: formatUnits(toAmount, 6),
      settlementTime,
      status,
    };

    res.json({
      success: true,
      trade,
    });
  } catch (error: any) {
    console.error('Error getting trade:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlement/trade/:tradeId/fund
 * Fund trade on smart contract (taker or maker)
 */
settlementRoutes.post('/trade/:tradeId/fund', async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { userAddress, role } = req.body; // role: 'taker' | 'maker'

    if (!userAddress || !role) {
      return res.status(400).json({ error: 'userAddress and role required' });
    }

    // Extract on-chain tradeId from trade.id (format: "trade_123")
    const onChainTradeId = BigInt(tradeId.replace('trade_', ''));
    
    // Verify trade exists on-chain
    try {
      await ContractService.getTrade(onChainTradeId);
    } catch (error) {
      return res.status(404).json({ error: 'Trade not found on-chain' });
    }

    let txHash: string;
    if (role === 'taker') {
      txHash = await ContractService.fundTrade(onChainTradeId, userAddress);
    } else if (role === 'maker') {
      txHash = await ContractService.makerFund(onChainTradeId, userAddress);
    } else {
      return res.status(400).json({ error: 'Invalid role. Must be "taker" or "maker"' });
    }

    // Try to update in-memory store if trade exists there (optional, not critical)
    try {
      SettlementService.updateTradeStatus(tradeId, 'funded', txHash);
    } catch (updateError: any) {
      // Ignore if trade not in memory store - on-chain is source of truth
      console.log(`Trade ${tradeId} not in memory store, status is on-chain only`);
    }

    res.json({
      success: true,
      message: 'Trade funded on-chain',
      txHash,
    });
  } catch (error: any) {
    console.error('Error funding trade:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlement/trade/:tradeId/settle
 * Trigger settlement (sẽ gọi smart contract)
 */
settlementRoutes.post('/trade/:tradeId/settle', async (req, res) => {
  try {
    const { tradeId } = req.params;
    
    // Extract on-chain tradeId from trade.id (format: "trade_123")
    const onChainTradeId = BigInt(tradeId.replace('trade_', ''));
    
    // Check on-chain status instead of backend status
    // Backend status may not be updated if frontend funds directly
    try {
      const onChainTrade = await ContractService.getTrade(onChainTradeId);
      
      // getTrade returns: [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, state, takerBalance, makerBalance]
      const tradeArray = onChainTrade as any;
      const fromAmount = tradeArray[4] as bigint;
      const toAmount = tradeArray[5] as bigint;
      const takerBalance = tradeArray[9] as bigint;
      const makerBalance = tradeArray[10] as bigint;
      const state = tradeArray[8] as number;
      const settlementTime = Number(tradeArray[6] as bigint);
      
      // Check if funded by comparing balances
      const takerFunded = takerBalance >= fromAmount;
      const makerFunded = makerBalance >= toAmount;
      const settled = state === 4; // TradeState.Settled
      
      if (settled) {
        return res.status(400).json({ error: 'Trade already settled' });
      }
      
      if (!takerFunded || !makerFunded) {
        return res.status(400).json({ 
          error: 'Trade not ready for settlement',
          details: {
            takerFunded,
            makerFunded,
            message: 'Both parties must fund before settlement'
          }
        });
      }
      
      const now = Math.floor(Date.now() / 1000);
      if (now < settlementTime) {
        return res.status(400).json({ 
          error: 'Settlement time not reached',
          details: {
            settlementTime,
            currentTime: now,
            timeRemaining: settlementTime - now,
            message: `Settlement time not reached. Wait ${Math.floor((settlementTime - now) / 60)}m ${(settlementTime - now) % 60}s`
          }
        });
      }
    } catch (checkError: any) {
      console.error('Error checking on-chain status:', checkError);
      // Continue to try settle anyway, let smart contract validate
    }
    
    // Call smart contract to settle
    const txHash = await ContractService.settle(onChainTradeId);
    
    // Try to update in-memory store if trade exists there (optional, not critical)
    // Trade status is already on-chain, so this is just for convenience
    try {
      SettlementService.updateTradeStatus(tradeId, 'settled', txHash);
    } catch (updateError: any) {
      // Ignore if trade not in memory store - on-chain is source of truth
      console.log(`Trade ${tradeId} not in memory store, status is on-chain only`);
    }

    res.json({
      success: true,
      message: 'Trade settled on-chain',
      txHash,
    });
  } catch (error: any) {
    console.error('Error settling trade:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlement/ready
 * Lấy trades sẵn sàng để settle
 */
settlementRoutes.get('/ready', (req, res) => {
  try {
    const trades = SettlementService.getTradesReadyForSettlement();

    res.json({
      success: true,
      trades,
      count: trades.length,
    });
  } catch (error: any) {
    console.error('Error getting ready trades:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlement/trades?userAddress=0x...
 * Lấy trades của user (taker hoặc maker) - đọc từ contract on-chain
 */
settlementRoutes.get('/trades', async (req, res) => {
  try {
    const { userAddress } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({ error: 'userAddress query parameter required' });
    }

    const trades = await SettlementService.getTradesByUser(userAddress);

    res.json({
      success: true,
      trades,
      count: trades.length,
    });
  } catch (error: any) {
    console.error('Error getting user trades:', error);
    res.status(500).json({ error: error.message });
  }
});

