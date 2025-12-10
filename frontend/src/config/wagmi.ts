import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';

// Define Arc testnet chain
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
  // Lưu ý: MetaMask/OKX yêu cầu decimals = 18 trong nativeCurrency để chấp nhận network,
  // dù token gas thực tế (USDC) có 6 decimals trên on-chain.
  // ERC20 USDC/EURC vẫn dùng 6 decimals trong contract, chỉ riêng field này phải set 18.
  decimals: 18,
  name: 'USDC',
  symbol: 'USDC',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
    },
    public: {
      http: ['https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.testnet.arc.network',
    },
  },
});

// Contract addresses - try to read from Settlement.json first, fallback to env/default
let settlementAddress: string;
try {
  // Dynamic import để tránh lỗi khi build (client-side only)
  const SettlementContract = require('@/abi/Settlement.json');
  settlementAddress = SettlementContract.address;
} catch {
  settlementAddress = process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS || '0x8c382CF82445c90482e7F1a14614fd4f92996053';
}

export const SETTLEMENT_CONTRACT_ADDRESS = settlementAddress;
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

// Backend API URL
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// RainbowKit config (mặc định)
export const wagmiConfig = getDefaultConfig({
  appName: 'NovaFX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [arcTestnet],
  ssr: true,
});

