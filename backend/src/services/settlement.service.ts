import { Trade, Quote } from '../types';
import { QuoteService } from './quote.service';
import { ContractService } from './contract.service';
import { formatUnits } from 'viem';

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

// In-memory storage (sẽ thay bằng database sau)
const tradeStore: Map<string, Trade> = new Map();

export class SettlementService {
  /**
   * Tạo trade từ accepted quote và gọi smart contract
   * @param takerSig - EIP-712 signature from taker (signed by frontend wallet)
   */
  static async createTrade(
    rfqId: string,
    quote: Quote,
    takerAddress: string,
    takerSig: string, // EIP-712 signature from frontend
    tenor: 'instant' | 'hourly' | 'daily' = 'instant',
    settlementTime?: number // Optional: if provided, use this instead of calculating
  ): Promise<Trade> {
    // Use provided settlementTime or calculate from tenor
    const finalSettlementTime = settlementTime || QuoteService.calculateSettlementTime(tenor);
    
    // Get token addresses
    const fromToken = quote.fromCurrency === 'USDC' 
      ? '0x3600000000000000000000000000000000000000'
      : '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
    const toToken = quote.toCurrency === 'USDC'
      ? '0x3600000000000000000000000000000000000000'
      : '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

    // Call smart contract to create trade
    const { tradeId: onChainTradeId, txHash } = await ContractService.createTrade(
      takerAddress,
      quote.makerAddress,
      quote.fromCurrency,
      quote.toCurrency,
      quote.fromAmount,
      quote.toAmount,
      finalSettlementTime, // Use finalSettlementTime
      takerSig, // From frontend (signed by user's wallet)
      quote.id // Pass quoteId for EIP-712 signature
    );

    const tradeId = `trade_${onChainTradeId.toString()}`;
    
    const trade: Trade = {
      id: tradeId,
      rfqId,
      quoteId: quote.id,
      takerAddress,
      makerAddress: quote.makerAddress,
      fromToken: quote.fromCurrency,
      toToken: quote.toCurrency,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      settlementTime: finalSettlementTime,
      status: 'pending',
      txHash,
    };

    tradeStore.set(tradeId, trade);

    console.log(`💰 Trade created on-chain: ${tradeId} (on-chain ID: ${onChainTradeId})`, trade);

    return trade;
  }

  /**
   * Lấy trade by ID
   */
  static getTrade(tradeId: string): Trade | undefined {
    return tradeStore.get(tradeId);
  }

  /**
   * Update trade status
   */
  static updateTradeStatus(tradeId: string, status: Trade['status'], txHash?: string): void {
    const trade = tradeStore.get(tradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }

    trade.status = status;
    if (txHash) {
      trade.txHash = txHash;
    }

    tradeStore.set(tradeId, trade);
  }

  /**
   * Check trades cần settlement
   */
  static getTradesReadyForSettlement(): Trade[] {
    const now = Math.floor(Date.now() / 1000);
    const trades: Trade[] = [];

    tradeStore.forEach((trade) => {
      if (
        trade.status === 'funded' &&
        now >= trade.settlementTime
      ) {
        trades.push(trade);
      }
    });

    return trades;
  }

  /**
   * Lấy tất cả trades của user (taker hoặc maker) - đọc từ contract on-chain
   */
  static async getTradesByUser(userAddress: string): Promise<Trade[]> {
    const trades: Trade[] = [];

    try {
      // Read all trades from contract
      const onChainTrades = await ContractService.getAllTradesFromContract();

      for (const { tradeId, data } of onChainTrades) {
        // getTrade returns: [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, state, takerBalance, makerBalance]
        const tradeArray = data as any;
        const taker = tradeArray[0] as string;
        const maker = tradeArray[1] as string;
        const fromToken = tradeArray[2] as string;
        const toToken = tradeArray[3] as string;
        const fromAmount = tradeArray[4] as bigint;
        const toAmount = tradeArray[5] as bigint;
        const settlementTime = Number(tradeArray[6] as bigint);
        const state = tradeArray[8] as number;
        const takerBalance = tradeArray[9] as bigint;
        const makerBalance = tradeArray[10] as bigint;

        // Filter by user address
        if (
          taker.toLowerCase() !== userAddress.toLowerCase() &&
          maker.toLowerCase() !== userAddress.toLowerCase()
        ) {
          continue;
        }

        // Convert token addresses to currency names
        const fromCurrency = fromToken.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 'USDC' : 'EURC';
        const toCurrency = toToken.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 'USDC' : 'EURC';

        // Determine status from state and derive funding status
        let status: Trade['status'] = 'pending';
        const settled = state === 4; // State.Settled
        const takerFunded = settled ? true : (state >= 1 && takerBalance >= fromAmount); // State >= FundedByTaker
        const makerFunded = settled ? true : (state >= 2 && makerBalance >= toAmount); // State >= FundedByMaker
        
        if (settled) status = 'settled';
        else if (state === 3) status = 'funded'; // FundedBoth
        else if (state >= 1) status = 'funded'; // FundedByTaker or FundedByMaker

        const trade: Trade & { takerFunded?: boolean; makerFunded?: boolean; settled?: boolean } = {
          id: `trade_${tradeId.toString()}`,
          rfqId: '', // Not available from contract
          quoteId: '', // Available but would need conversion
          takerAddress: taker,
          makerAddress: maker,
          fromToken: fromCurrency,
          toToken: toCurrency,
          fromAmount: formatUnits(fromAmount, 6),
          toAmount: formatUnits(toAmount, 6),
          settlementTime,
          status,
          // Add on-chain funding status for frontend
          takerFunded,
          makerFunded,
          settled,
          // txHash not available from contract read
        };

        trades.push(trade);
      }
    } catch (error) {
      console.error('Error reading trades from contract:', error);
      // Fallback to memory if contract read fails
      tradeStore.forEach((trade) => {
        if (
          trade.takerAddress.toLowerCase() === userAddress.toLowerCase() ||
          trade.makerAddress.toLowerCase() === userAddress.toLowerCase()
        ) {
          trades.push(trade);
        }
      });
    }

    return trades.sort((a, b) => {
      // Sort by tradeId (newest first)
      const aId = parseInt(a.id.split('_')[1]) || 0;
      const bId = parseInt(b.id.split('_')[1]) || 0;
      return bId - aId;
    });
  }

  /**
   * Lấy tất cả trades
   */
  static getAllTrades(): Trade[] {
    return Array.from(tradeStore.values()).sort((a, b) => {
      return parseInt(b.id.split('_')[1]) - parseInt(a.id.split('_')[1]);
    });
  }
}

