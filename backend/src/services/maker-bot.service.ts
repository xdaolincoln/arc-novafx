import { RFQService } from './rfq.service';
import { Quote } from '../types';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Maker Bot Service - Tự động provide quotes khi có RFQ mới
 * Chạy 3 BOT instances với pricing strategy khác nhau
 */
export class MakerBotService {
  private static bots: Array<{ id: number; makerAddress: string; strategy: (rate: number) => number }> = [];
  private static isRunning = false;
  private static pollInterval: NodeJS.Timeout | null = null;
  private static processedRFQs: Set<string> = new Set(); // Track RFQs đã xử lý bởi mỗi BOT

  /**
   * Validate and normalize private key
   */
  private static normalizePrivateKey(key: string | undefined): string | null {
    if (!key) return null;
    
    // Trim whitespace
    const trimmed = key.trim();
    if (!trimmed) return null;
    
    // Normalize to hex format
    let normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
    
    // Validate hex format (should be 66 chars with 0x prefix = 64 hex chars)
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
      console.warn(`⚠️  Invalid private key format (should be 64 hex characters): ${normalized.substring(0, 20)}...`);
      return null;
    }
    
    return normalized;
  }

  /**
   * Initialize BOTs từ environment variables
   * All BOTs use same random variance: ±1.0% from market rate
   */
  static initialize() {
    // Helper function to generate random variance strategy
    const createRandomVarianceStrategy = (variancePercent: number) => {
      return (rate: number) => {
        // Random between -variancePercent and +variancePercent
        const randomVariance = (Math.random() * 2 - 1) * (variancePercent / 100);
        return rate * (1 + randomVariance);
      };
    };

    // BOT 1: Random variance ±1.0%
    const bot1Key = this.normalizePrivateKey(process.env.MAKER_BOT1_PRIVATE_KEY);
    if (bot1Key) {
      try {
        const account1 = privateKeyToAccount(bot1Key as `0x${string}`);
        this.bots.push({
          id: 1,
          makerAddress: account1.address,
          strategy: createRandomVarianceStrategy(1.0), // ±1.0% variance
        });
        console.log(`✅ BOT 1 initialized: ${account1.address} (Random ±1.0%)`);
      } catch (error: any) {
        console.error(`❌ Failed to initialize BOT 1: ${error.message}`);
      }
    }

    // BOT 2: Random variance ±1.0%
    const bot2Key = this.normalizePrivateKey(process.env.MAKER_BOT2_PRIVATE_KEY);
    if (bot2Key) {
      try {
        const account2 = privateKeyToAccount(bot2Key as `0x${string}`);
        this.bots.push({
          id: 2,
          makerAddress: account2.address,
          strategy: createRandomVarianceStrategy(1.0), // ±1.0% variance
        });
        console.log(`✅ BOT 2 initialized: ${account2.address} (Random ±1.0%)`);
      } catch (error: any) {
        console.error(`❌ Failed to initialize BOT 2: ${error.message}`);
      }
    }

    // BOT 3: Random variance ±1.0%
    const bot3Key = this.normalizePrivateKey(process.env.MAKER_BOT3_PRIVATE_KEY);
    if (bot3Key) {
      try {
        const account3 = privateKeyToAccount(bot3Key as `0x${string}`);
        this.bots.push({
          id: 3,
          makerAddress: account3.address,
          strategy: createRandomVarianceStrategy(1.0), // ±1.0% variance
        });
        console.log(`✅ BOT 3 initialized: ${account3.address} (Random ±1.0%)`);
      } catch (error: any) {
        console.error(`❌ Failed to initialize BOT 3: ${error.message}`);
      }
    }

    if (this.bots.length === 0) {
      console.warn('⚠️  No valid BOT private keys found. Set MAKER_BOT1_PRIVATE_KEY, MAKER_BOT2_PRIVATE_KEY, MAKER_BOT3_PRIVATE_KEY in .env');
      console.warn('   Private key format: 64 hex characters (with or without 0x prefix)');
    } else {
      console.log(`🤖 Initialized ${this.bots.length} Maker BOTs`);
    }
  }

  /**
   * Start polling for new RFQs
   */
  static start() {
    if (this.isRunning) {
      console.log('⚠️  Maker BOTs already running');
      return;
    }

    if (this.bots.length === 0) {
      this.initialize();
    }

    if (this.bots.length === 0) {
      console.warn('⚠️  No BOT private keys configured. Set MAKER_BOT1_PRIVATE_KEY, MAKER_BOT2_PRIVATE_KEY, MAKER_BOT3_PRIVATE_KEY in .env');
      return;
    }

    this.isRunning = true;
    console.log(`🚀 Starting ${this.bots.length} Maker BOTs...`);

    // Poll for quotes every 3 seconds
    this.pollInterval = setInterval(() => {
      this.pollAndProvideQuotes();
    }, 3000);

    // Poll for trades to auto-fund every 10 seconds
    setInterval(() => {
      this.pollAndAutoFund();
    }, 10000);

    // Initial polls
    this.pollAndProvideQuotes();
    this.pollAndAutoFund();
  }

  /**
   * Stop polling
   */
  static stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Maker BOTs stopped');
  }

  /**
   * Poll for pending RFQs and provide quotes
   */
  private static async pollAndProvideQuotes() {
    try {
      // Get pending RFQs
      const pendingRFQs = RFQService.getPendingRFQs();

      if (pendingRFQs.length === 0) {
        return; // No pending RFQs
      }

      // Process each RFQ with each BOT
      for (const rfq of pendingRFQs) {
        for (const bot of this.bots) {
          const rfqBotKey = `${rfq.id}_${bot.id}`;

          // Check if this BOT already provided quote for this RFQ
          const quotes = RFQService.getQuotes(rfq.id);
          const alreadyQuoted = quotes.some(q => q.makerAddress.toLowerCase() === bot.makerAddress.toLowerCase());

          if (!alreadyQuoted && !this.processedRFQs.has(rfqBotKey)) {
            // Mark as processing
            this.processedRFQs.add(rfqBotKey);

            try {
              // Provide quote with BOT's strategy
              // Note: MakerService.provideQuote sẽ lấy rate từ API, sau đó apply strategy
              await MakerBotService.provideQuoteWithStrategy(rfq.id, bot.makerAddress, bot.strategy);
              
              console.log(`✅ BOT ${bot.id} provided quote for RFQ ${rfq.id}`);
            } catch (error: any) {
              console.error(`❌ BOT ${bot.id} failed to provide quote for RFQ ${rfq.id}:`, error.message);
              // Remove from processed if failed (allow retry)
              this.processedRFQs.delete(rfqBotKey);
            }
          }
        }
      }

      // Clean up processed RFQs set periodically (prevent memory leak)
      // Remove entries for RFQs older than 10 minutes
      if (this.processedRFQs.size > 1000) {
        // Simple cleanup: clear if too large (in production, use timestamp-based cleanup)
        this.processedRFQs.clear();
        console.log('🧹 Cleaned up processed RFQs cache');
      }
    } catch (error: any) {
      console.error('Error polling RFQs:', error);
    }
  }

  /**
   * Poll for trades where BOT is maker and auto-fund if needed
   */
  private static async pollAndAutoFund() {
    try {
      const { ContractService } = await import('./contract.service');
      
      // Get all trades from contract
      const allTrades = await ContractService.getAllTradesFromContract();
      
      for (const trade of allTrades) {
        // getAllTradesFromContract returns: { tradeId: bigint, data: [...] }
        const tradeIdBigInt = trade.tradeId;
        const tradeId = `trade_${tradeIdBigInt.toString()}`;
        const tradeData = trade.data; // Array: [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, state, takerBalance, makerBalance]
        
        if (!tradeData || !Array.isArray(tradeData)) {
          continue;
        }
        
        // Parse trade data (from getTrade response)
        // Ensure makerAddress is a string
        const makerAddress = String(tradeData[1]); // maker is index 1
        const state = Number(tradeData[8]); // state is index 8
        
        // Check if any BOT is the maker
        const bot = this.bots.find(b => b.makerAddress.toLowerCase() === makerAddress.toLowerCase());
        
        if (!bot) {
          continue; // Not a BOT trade
        }
        
        // Check if trade needs maker funding
        // State: 0=Created, 1=FundedByTaker, 2=FundedByMaker, 3=FundedBoth, 4=Settled, 5=Cancelled, 6=Expired
        const needsMakerFund = state === 1; // Only taker funded (state 1 = FundedByTaker)
        
        if (needsMakerFund) {
          try {
            // Get BOT private key
            const botKeys = [
              process.env.MAKER_BOT1_PRIVATE_KEY,
              process.env.MAKER_BOT2_PRIVATE_KEY,
              process.env.MAKER_BOT3_PRIVATE_KEY,
            ];
            
            const botPrivateKey = botKeys[bot.id - 1]; // bot.id is 1, 2, or 3
            if (!botPrivateKey) {
              console.warn(`⚠️  BOT ${bot.id} private key not found, cannot auto-fund`);
              continue;
            }
            
            console.log(`💰 BOT ${bot.id} auto-funding trade ${tradeId}...`);
            await ContractService.makerFund(tradeIdBigInt, makerAddress, botPrivateKey);
            console.log(`✅ BOT ${bot.id} auto-funded trade ${tradeId}`);
          } catch (error: any) {
            // Log but don't throw - may be temporary issues (gas, balance, approval, etc.)
            console.warn(`⚠️  BOT ${bot.id} failed to auto-fund trade ${tradeId}:`, error.message);
          }
        }
      }
    } catch (error: any) {
      console.error('Error polling and auto-funding trades:', error);
    }
  }

  /**
   * Provide quote with custom pricing strategy
   */
  private static async provideQuoteWithStrategy(
    rfqId: string,
    makerAddress: string,
    strategy: (rate: number) => number
  ): Promise<string> {
    const rfq = RFQService.getRFQ(rfqId);
    if (!rfq) {
      throw new Error('RFQ not found');
    }

    // Get market rate
    const { getExchangeRate } = await import('./price.service');
    const marketRate = await getExchangeRate(rfq.from.currency, rfq.to.currency);
    
    // Apply BOT strategy
    const adjustedRate = strategy(marketRate);
    
    const fromAmount = parseFloat(rfq.from.amount);
    const toAmount = fromAmount * adjustedRate;

    // Create quote with adjusted rate
    const quote: Omit<Quote, 'id' | 'rfqId'> = {
      makerAddress,
      fromCurrency: rfq.from.currency,
      toCurrency: rfq.to.currency,
      fromAmount: rfq.from.amount,
      toAmount: toAmount.toFixed(6),
      rate: adjustedRate,
      expiry: Math.floor(Date.now() / 1000) + 300, // 5 minutes expiry
    };

    const quoteId = RFQService.addQuote(rfqId, quote);
    return quoteId;
  }
}

