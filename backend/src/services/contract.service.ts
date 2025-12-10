import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, defineChain, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Load ABI from file
const abiPath = path.join(__dirname, '../abi/Settlement.json');
const settlementContractJson = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
const SETTLEMENT_ABI = settlementContractJson.abi;

// Contract address - ưu tiên từ ABI file, fallback về env
const SETTLEMENT_CONTRACT_ADDRESS = settlementContractJson.address || process.env.SETTLEMENT_CONTRACT_ADDRESS;
if (!SETTLEMENT_CONTRACT_ADDRESS) {
  throw new Error('SETTLEMENT_CONTRACT_ADDRESS must be set in ABI file or .env');
}
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

const ERC20_ABI = [
  {
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Setup viem clients
const rpcUrl = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

// Define Arc testnet chain
const arcTestnetChain = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    decimals: 6,
    name: 'USDC',
    symbol: 'USDC',
  },
  rpcUrls: {
    default: {
      http: [rpcUrl],
    },
  },
});

// Public client để read
const publicClient = createPublicClient({
  chain: arcTestnetChain,
  transport: http(rpcUrl),
});

/**
 * Get wallet client từ private key
 * Note: Trong production, nên dùng service account riêng hoặc user tự sign
 */
function getWalletClient(privateKey: string) {
  if (!privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }
  
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  return createWalletClient({
    account,
    chain: arcTestnetChain,
    transport: http(rpcUrl),
  });
}

/**
 * Get maker address từ MAKER_PRIVATE_KEY (derive address)
 * Note: Chỉ dùng để identify maker trong quotes, không dùng để sign
 */
export function getMakerAddress(): string {
  const makerPrivateKey = process.env.MAKER_PRIVATE_KEY;
  
  if (!makerPrivateKey) {
    throw new Error('MAKER_PRIVATE_KEY must be set in .env to derive maker address');
  }
  
  const key = makerPrivateKey.startsWith('0x') ? makerPrivateKey : `0x${makerPrivateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  return account.address;
}

/**
 * Get taker address từ TAKER_PRIVATE_KEY (derive address)
 * Note: Chỉ dùng để identify taker trong RFQ, không dùng để sign
 */
export function getTakerAddress(): string {
  const takerPrivateKey = process.env.TAKER_PRIVATE_KEY;
  
  if (!takerPrivateKey) {
    throw new Error('TAKER_PRIVATE_KEY must be set in .env to derive taker address');
  }
  
  const key = takerPrivateKey.startsWith('0x') ? takerPrivateKey : `0x${takerPrivateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  return account.address;
}

/**
 * Get maker wallet client để sign transactions (nếu cần)
 * Note: Hiện tại backend dùng PRIVATE_KEY chung để sign, nhưng có thể dùng riêng cho maker
 */
export function getMakerWalletClient() {
  const makerPrivateKey = process.env.MAKER_PRIVATE_KEY;
  
  if (!makerPrivateKey) {
    throw new Error('MAKER_PRIVATE_KEY must be set to sign maker transactions');
  }
  
  return getWalletClient(makerPrivateKey);
}

/**
 * DEPRECATED: Taker should sign from frontend wallet, not backend
 * This function is kept for backwards compatibility but should not be used
 */
export function getTakerWalletClient() {
  throw new Error('getTakerWalletClient is deprecated. Taker should sign from frontend wallet.');
}

/**
 * Convert currency string to token address
 */
function getTokenAddress(currency: string): `0x${string}` {
  const addresses: Record<string, `0x${string}`> = {
    USDC: USDC_ADDRESS as `0x${string}`,
    EURC: EURC_ADDRESS as `0x${string}`,
  };
  
  const address = addresses[currency.toUpperCase()];
  if (!address) {
    throw new Error(`Unknown currency: ${currency}`);
  }
  
  return address;
}

/**
 * Convert amount string to BigInt (6 decimals for USDC/EURC)
 */
function parseTokenAmount(amount: string): bigint {
  return parseUnits(amount, 6);
}

/**
 * Find maker private key from maker address
 * Check all BOT keys and MAKER_PRIVATE_KEY
 */
function findMakerPrivateKey(makerAddress: string): string | undefined {
  // Normalize address for comparison
  const normalizedMaker = makerAddress.toLowerCase();

  // Check BOT keys
  const botKeys = [
    process.env.MAKER_BOT1_PRIVATE_KEY,
    process.env.MAKER_BOT2_PRIVATE_KEY,
    process.env.MAKER_BOT3_PRIVATE_KEY,
  ];

  for (const botKey of botKeys) {
    if (!botKey) continue;
    
    try {
      const normalizedKey = botKey.trim().startsWith('0x') ? botKey.trim() : `0x${botKey.trim()}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      if (account.address.toLowerCase() === normalizedMaker) {
        return normalizedKey;
      }
    } catch (error) {
      // Invalid key, skip
      continue;
    }
  }

  // Check MAKER_PRIVATE_KEY
  const makerKey = process.env.MAKER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (makerKey) {
    try {
      const normalizedKey = makerKey.trim().startsWith('0x') ? makerKey.trim() : `0x${makerKey.trim()}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      if (account.address.toLowerCase() === normalizedMaker) {
        return normalizedKey;
      }
    } catch (error) {
      // Invalid key, skip
    }
  }

  return undefined;
}

export class ContractService {
  /**
   * Create trade on smart contract
   * Returns on-chain tradeId
   * 
   * @param takerSig - EIP-712 signature from taker (signed by frontend wallet)
   * @param makerPrivateKey - Private key for maker (BOT) to sign EIP-712 (optional, will auto-detect from makerAddress)
   */
static async createTrade(
    takerAddress: string,
    makerAddress: string,
    fromCurrency: string,
    toCurrency: string,
    fromAmount: string,
    toAmount: string,
    settlementTime: number,
    takerSig: string, // Taker signature from frontend
    quoteId?: string,
    makerPrivateKey?: string
  ): Promise<{ tradeId: bigint; txHash: string }> {
    // Auto-detect maker private key from maker address if not provided
    if (!makerPrivateKey) {
      makerPrivateKey = findMakerPrivateKey(makerAddress);
    }
    
    // Fallback to MAKER_PRIVATE_KEY if not found
    if (!makerPrivateKey) {
      makerPrivateKey = process.env.MAKER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    }
    
    if (!makerPrivateKey) {
      throw new Error(`Maker private key not found for address ${makerAddress}. Please set MAKER_BOT*_PRIVATE_KEY or MAKER_PRIVATE_KEY in .env`);
    }

    // Verify the private key matches the maker address
    const makerAccount = privateKeyToAccount((makerPrivateKey.startsWith('0x') ? makerPrivateKey : `0x${makerPrivateKey}`) as `0x${string}`);
    if (makerAccount.address.toLowerCase() !== makerAddress.toLowerCase()) {
      throw new Error(`Private key does not match maker address. Expected ${makerAddress}, got ${makerAccount.address}`);
    }

    console.log(`✅ Found matching private key for maker ${makerAddress}`);

    if (!takerSig || !takerSig.startsWith('0x')) {
      throw new Error('Valid taker signature required (must start with 0x)');
    }

    const walletClient = getWalletClient(makerPrivateKey);
    
    const fromToken = getTokenAddress(fromCurrency);
    const toToken = getTokenAddress(toCurrency);
    const fromAmountBigInt = parseTokenAmount(fromAmount);
    const toAmountBigInt = parseTokenAmount(toAmount);
    const settlementTimeBigInt = BigInt(Math.floor(settlementTime));

    // Generate quoteId if not provided
    const quoteIdBytes32 = quoteId 
      ? keccak256(toHex(quoteId)) as `0x${string}`
      : keccak256(toHex(`${takerAddress}-${makerAddress}-${fromAmount}-${toAmount}-${settlementTime}`)) as `0x${string}`;

    // EIP-712 domain - hardcode vì đã biết từ deploy
    // IMPORTANT: verifyingContract MUST match exactly what frontend uses
    const domain = {
      name: 'Arc FX Settlement',
      version: '1',
      chainId: 5042002,
      verifyingContract: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
    };
    
    console.log('🔐 Backend domain verifyingContract:', domain.verifyingContract);
    console.log('🔐 Backend SETTLEMENT_CONTRACT_ADDRESS:', SETTLEMENT_CONTRACT_ADDRESS);

    // Prepare EIP-712 types
    const types = {
      Trade: [
        { name: 'taker', type: 'address' },
        { name: 'maker', type: 'address' },
        { name: 'fromToken', type: 'address' },
        { name: 'toToken', type: 'address' },
        { name: 'fromAmount', type: 'uint256' },
        { name: 'toAmount', type: 'uint256' },
        { name: 'settlementTime', type: 'uint256' },
        { name: 'quoteId', type: 'bytes32' },
      ],
    };

    // IMPORTANT: Don't normalize addresses to lowercase - use original addresses
    // ECDSA.recover returns checksummed address, so we need to compare with original addresses
    const message = {
      taker: takerAddress as `0x${string}`,
      maker: makerAddress as `0x${string}`,
      fromToken: fromToken as `0x${string}`,
      toToken: toToken as `0x${string}`,
      fromAmount: fromAmountBigInt,
      toAmount: toAmountBigInt,
      settlementTime: settlementTimeBigInt,
      quoteId: quoteIdBytes32,
    };

    console.log('🔐 Backend EIP-712 domain:', JSON.stringify(domain, null, 2));
    console.log('🔐 Backend EIP-712 message:', {
      taker: message.taker,
      maker: message.maker,
      fromToken: message.fromToken,
      toToken: message.toToken,
      fromAmount: message.fromAmount.toString(),
      toAmount: message.toAmount.toString(),
      settlementTime: message.settlementTime.toString(),
      quoteId: message.quoteId,
    });
    console.log('🔐 Backend received takerSig:', takerSig?.substring(0, 20) + '...');

    // Maker signs EIP-712 signature (taker signature comes from frontend)
    // makerAccount was already verified above to match makerAddress
    const makerWalletClient = createWalletClient({
      account: makerAccount,
      chain: arcTestnetChain,
      transport: http(rpcUrl),
    });

    // Sign maker signature with EIP-712
    const makerSig = await makerWalletClient.signTypedData({
      account: makerAccount,
      domain,
      types,
      primaryType: 'Trade',
      message,
    });

    // takerSig is already provided from frontend

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: 'createTrade',
      args: [
        takerAddress as `0x${string}`,
        makerAddress as `0x${string}`,
        fromToken,
        toToken,
        fromAmountBigInt,
        toAmountBigInt,
        settlementTimeBigInt,
        quoteIdBytes32,
        takerSig,
        makerSig,
      ],
    });

    // Wait for transaction
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    // Parse tradeId from TradeCreated event
    // TradeCreated event: topics[0] = event signature, topics[1] = tradeId, topics[2] = taker, topics[3] = maker
    let tradeId: bigint;
    
    // Find TradeCreated event in logs
    const tradeCreatedLog = receipt.logs.find((log: any) => {
      return log.address.toLowerCase() === SETTLEMENT_CONTRACT_ADDRESS.toLowerCase() &&
             log.topics && log.topics.length >= 2;
    });

    if (tradeCreatedLog && tradeCreatedLog.topics && tradeCreatedLog.topics.length >= 2 && tradeCreatedLog.topics[1]) {
      // tradeId is in topics[1] (first indexed parameter after event signature)
      tradeId = BigInt(tradeCreatedLog.topics[1]);
    } else {
      // Fallback: read counter (tradeId = counter - 1)
      const counter = await publicClient.readContract({
        address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
        abi: SETTLEMENT_ABI,
        functionName: 'tradeCounter',
        args: [],
      });
      tradeId = (counter as bigint) - 1n;
    }
    
    return {
      tradeId,
      txHash: hash,
    };
  }

  /**
   * Approve tokens for contract
   */
  static async approveToken(
    tokenAddress: string,
    amount: bigint,
    privateKey: string
  ): Promise<string> {
    const walletClient = getWalletClient(privateKey);
    
    const hash = await walletClient.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`, amount],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    
    return hash;
  }

  /**
   * Fund trade (taker funds)
   * Note: Dùng TAKER_PRIVATE_KEY để sign, không dùng PRIVATE_KEY chung
   */
  static async fundTrade(
    tradeId: bigint,
    userAddress: string,
    privateKey?: string
  ): Promise<string> {
    // Dùng TAKER_PRIVATE_KEY để sign, không dùng PRIVATE_KEY chung
    if (!privateKey) {
      privateKey = process.env.TAKER_PRIVATE_KEY;
    }
    
    if (!privateKey) {
      throw new Error('TAKER_PRIVATE_KEY required to fund trade');
    }

    const walletClient = getWalletClient(privateKey);
    
    // Verify user is taker and get trade info
    const trade = await publicClient.readContract({
      address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: 'trades',
      args: [tradeId],
    });

    // trade is a tuple: [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, takerSignature, makerSignature, takerFunded, makerFunded, settled]
    const tradeArray = trade as any;
    const tradeTaker = tradeArray[0] as string;
    const fromToken = tradeArray[2] as string;
    const fromAmount = tradeArray[4] as bigint;
    
    if (tradeTaker.toLowerCase() !== userAddress.toLowerCase()) {
      throw new Error('Only taker can fund this trade');
    }

    // Check allowance
    const allowance = await publicClient.readContract({
      address: fromToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [userAddress as `0x${string}`, SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`],
    });

    // Approve if needed
    if (allowance < fromAmount) {
      console.log(`Approving ${fromAmount} tokens for contract...`);
      await this.approveToken(fromToken, fromAmount, privateKey);
    }

    // Contract uses fundTrade(tradeId, amountToFund) - taker funds fromAmount
    const hash = await walletClient.writeContract({
      address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: 'fundTrade',
      args: [tradeId, fromAmount], // Pass amountToFund for taker
    });

    await publicClient.waitForTransactionReceipt({ hash });
    
    return hash;
  }

  /**
   * Maker fund trade
   * Note: Contract uses fundTrade(tradeId, amountToFund) for both taker and maker
   */
  static async makerFund(
    tradeId: bigint,
    userAddress: string,
    privateKey?: string
  ): Promise<string> {
    // Dùng MAKER_PRIVATE_KEY để sign, không dùng PRIVATE_KEY chung
    if (!privateKey) {
      privateKey = process.env.MAKER_PRIVATE_KEY;
    }
    
    if (!privateKey) {
      throw new Error('MAKER_PRIVATE_KEY required to fund trade');
    }

    const walletClient = getWalletClient(privateKey);
    
    // Verify user is maker and get trade info
    // Use getTrade instead of trades mapping (which may not exist or return different format)
    const tradeData = await this.getTrade(tradeId);
    
    // getTrade returns: [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, state, takerBalance, makerBalance]
    const tradeArray = tradeData as any[];
    if (!Array.isArray(tradeArray) || tradeArray.length < 9) {
      throw new Error('Invalid trade data format');
    }
    
    const tradeMaker = String(tradeArray[1]); // Ensure it's a string
    const toToken = String(tradeArray[3]); // Ensure it's a string
    const toAmount = tradeArray[5] as bigint;
    
    if (tradeMaker.toLowerCase() !== userAddress.toLowerCase()) {
      throw new Error('Only maker can fund this trade');
    }

    // Check allowance
    const allowance = await publicClient.readContract({
      address: toToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [userAddress as `0x${string}`, SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`],
    });

    // Approve if needed
    if (allowance < toAmount) {
      console.log(`Approving ${toAmount} tokens for contract...`);
      await this.approveToken(toToken, toAmount, privateKey);
    }

    // Contract uses fundTrade(tradeId, amountToFund) for both taker and maker
    const hash = await walletClient.writeContract({
      address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: 'fundTrade',
      args: [tradeId, toAmount], // Pass amountToFund for maker
    });

    await publicClient.waitForTransactionReceipt({ hash });
    
    return hash;
  }

  /**
   * Settle trade
   */
  static async settle(
    tradeId: bigint,
    privateKey?: string
  ): Promise<string> {
    if (!privateKey) {
      privateKey = process.env.PRIVATE_KEY;
    }
    
    if (!privateKey) {
      throw new Error('Private key required');
    }

    const walletClient = getWalletClient(privateKey);

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: 'settle',
      args: [tradeId],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    
    return hash;
  }

  /**
   * Get trade info from contract
   */
  static async getTrade(tradeId: bigint) {
    const trade = await publicClient.readContract({
      address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: 'getTrade',
      args: [tradeId],
    });

    return trade;
  }

  /**
   * Get all trades from contract on-chain
   * Returns array of trade data [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, state, takerBalance, makerBalance]
   */
  static async getAllTradesFromContract() {
    try {
      // Get tradeCounter
      const counter = await publicClient.readContract({
        address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
        abi: SETTLEMENT_ABI,
        functionName: 'tradeCounter',
        args: [],
      });

      const tradeCounter = counter as bigint;
      if (tradeCounter <= 1n) {
        return [];
      }

      // Get all trades from 1 to tradeCounter - 1
      const trades: Array<{ tradeId: bigint; data: any }> = [];
      for (let i = 1n; i < tradeCounter; i++) {
        try {
          const tradeData = await this.getTrade(i);
          if (tradeData) {
            trades.push({ tradeId: i, data: tradeData });
          }
        } catch (error) {
          // Skip if trade doesn't exist or error reading
          continue;
        }
      }

      return trades;
    } catch (error) {
      console.error('Error getting trades from contract:', error);
      return [];
    }
  }
}

