# FX Trading App on Arc Network

FX trading application on Arc Testnet using Request-for-Quote (RFQ) model with atomic settlement via smart contract.

## Overview

Complete FX trading system with:
- **RFQ Model**: Takers request quotes, Makers provide quotes
- **Automated Maker BOTs**: 3 BOTs automatically provide quotes with different pricing strategies
- **EIP-712 Signature**: Off-chain quote verification before on-chain trade creation
- **Atomic Settlement**: Smart contract escrow ensures secure transactions
- **Auto-funding**: Maker BOTs automatically fund trades when accepted
- **Settlement Schedules**: Instant (2 min), Hourly, Daily

## System Architecture

```
Frontend (Next.js)
├── RFQPage: Create RFQ, display quotes, accept quote
├── TradeList: Manage trades (fund, settle)
├── TradeStatus: Read on-chain status from contract
└── WalletButton: Connect wallet (RainbowKit)
         ↓ HTTP API
Backend API (Node.js)
├── RFQ Service: Manage RFQ requests
├── Quote Service: Aggregation, best quote selection
├── Settlement Service: Trade management, settlement
├── Maker Bot Service: 3 BOTs auto-provide quotes
└── Contract Service: Smart contract interaction
         ↓ Viem/HTTP RPC
Smart Contract (Solidity)
└── Settlement.sol: Escrow, atomic settlement, EIP-712
         ↓
    Arc Testnet (Chain ID: 5042002)
```

## Operating Flow

### 1. RFQ Creation Flow

User connects wallet → Fills form (from/to currency, amount, tenor) → Submits → Backend creates RFQ ID → Frontend displays RFQ ID and starts auto-refresh → Waits for Maker BOTs to provide quotes

**API:** `POST /api/rfq` with `{ from, to, tenor, takerAddress }` → Returns `{ rfqId, rfq }`

### 2. Quote Provision Flow

Maker Bot Service polls every 3 seconds → Each BOT fetches pending RFQs → Fetches exchange rate from CoinGecko API → Applies pricing strategy (BOT1: 0.98x, BOT2: 1.0x, BOT3: 1.02x) → Calculates toAmount → Creates quote → Frontend auto-refresh displays new quotes

**BOT Strategies:**
- BOT 1 (Aggressive): `rate * 0.98` - Better price for taker
- BOT 2 (Standard): `rate * 1.0` - Standard price from CoinGecko
- BOT 3 (Conservative): `rate * 1.02` - Better price for maker

### 3. Quote Acceptance Flow

User selects best quote → Clicks "Accept Quote" → Frontend calculates settlementTime based on tenor → Prepares EIP-712 message (taker, maker, tokens, amounts, settlementTime, quoteId) → User signs EIP-712 with wallet → Frontend sends to backend with takerSig → Backend finds maker private key → Maker signs EIP-712 message → Backend calls contract.createTrade() with both signatures → Contract verifies signatures → Creates trade on-chain → Returns tradeId

**EIP-712 Domain:**
- name: "Arc FX Settlement"
- version: "1"
- chainId: 5042002
- verifyingContract: Settlement contract address

### 4. Funding Flow

**Taker Funding:**
User views "My Trades" → TradeStatus reads on-chain status → User clicks "Fund" → Frontend checks token allowance → Approves if needed → Calls fundTrade(tradeId, fromAmount) → Contract transfers tokens to escrow → State: Created → FundedByTaker → Frontend updates status

**Maker Funding (Auto):**
Maker Bot Service polls every 10 seconds → Filters trades where maker = BOT address → Checks state = FundedByTaker → BOT finds private key → Calls fundTrade(tradeId, toAmount) → Contract transfers tokens → State: FundedByTaker → FundedBoth

**Maker Funding (Manual):**
Same as Taker funding but user clicks "Fund X EURC" and calls fundTrade(tradeId, toAmount)

### 5. Settlement Flow

Trade state = FundedBoth → Frontend shows countdown to settlementTime → When settlementTime reached → "Settle Trade" button enabled → User clicks → Backend verifies on-chain status → Calls contract.settle(tradeId) → Contract verifies state and timing → Transfers tokens atomically (fromToken to maker, toToken to taker) → State: FundedBoth → Settled → Frontend displays "Trade settled"

### 6. Expired Trade Flow

Trade exceeds grace period (1 hour after settlementTime) and not settled → Contract state = Expired → Frontend displays warning → User can call refundIfExpired(tradeId) → Contract refunds all escrow balances

## Project Structure

```
arc/
├── contracts/          # Smart Contracts
│   ├── contracts/Settlement.sol
│   ├── scripts/deploy.ts
│   └── hardhat.config.ts
├── backend/            # Backend API
│   ├── src/routes/     # API routes
│   ├── src/services/   # Business logic
│   └── src/abi/        # Contract ABI
└── frontend/           # Frontend (Next.js)
    ├── src/components/
    ├── src/config/
    └── src/abi/
```

## Tech Stack

**Smart Contracts:** Solidity ^0.8.20, OpenZeppelin (EIP-712, ECDSA, SafeERC20, ReentrancyGuard, Ownable), Hardhat, viaIR enabled

**Backend:** Node.js, TypeScript, Express, Viem, CoinGecko API

**Frontend:** Next.js, React, Wagmi, RainbowKit, Viem

**Blockchain:** Arc Testnet (Chain ID: 5042002), RPC: https://rpc.testnet.arc.network, Gas Token: USDC (6 decimals), Tokens: USDC, EURC (6 decimals)

## Setup & Installation

### Prerequisites
- Node.js 18+
- Arc testnet wallet (MetaMask/OKX)
- Testnet tokens (USDC/EURC) from Circle Faucet

### Installation

```bash
# Clone repository
git clone <repo-url>
cd arc

# Setup Contracts
cd contracts && npm install
cp .env.example .env  # Configure PRIVATE_KEY

# Setup Backend
cd ../backend && npm install
cp .env.example .env
# Configure: PRIVATE_KEY, MAKER_PRIVATE_KEY, MAKER_BOT1_PRIVATE_KEY, 
#            MAKER_BOT2_PRIVATE_KEY, MAKER_BOT3_PRIVATE_KEY, ARC_RPC_URL

# Setup Frontend
cd ../frontend && npm install
cp .env.example .env.local
# Configure: NEXT_PUBLIC_BACKEND_URL=http://localhost:3001

# Deploy Contracts
cd ../contracts
npx hardhat compile
npx hardhat run scripts/deploy.ts --network arc-testnet
# ABI auto-copied to frontend/src/abi and backend/src/abi
```

### Development

```bash
# Terminal 1: Backend
cd backend && npm run dev
# Server: http://localhost:3001
# Maker BOTs auto-start

# Terminal 2: Frontend
cd frontend && npm run dev
# App: http://localhost:3000
```

## API Endpoints

**RFQ:** `POST /api/rfq`, `GET /api/rfq/:rfqId`

**Quotes:** `GET /api/quotes/:rfqId`, `POST /api/quotes/:rfqId/accept`

**Settlement:** `GET /api/settlement/trades`, `GET /api/settlement/trade/:tradeId`, `POST /api/settlement/trade/:tradeId/fund`, `POST /api/settlement/trade/:tradeId/settle`

## Maker BOTs

3 automated Maker BOTs with different pricing strategies:

1. **BOT 1 (Aggressive)**: `rate * 0.98` - Better for taker
2. **BOT 2 (Standard)**: `rate * 1.0` - Standard price
3. **BOT 3 (Conservative)**: `rate * 1.02` - Better for maker

**Features:**
- Auto Quote Provision: Poll RFQs every 3 seconds
- Auto Funding: Poll trades every 10 seconds
- Private Key Management: Each BOT has separate private key from `.env`

## Security Features

**EIP-712 Signatures:** Both taker and maker must sign EIP-712 message off-chain, contract verifies before trade creation

**Smart Contract Security:** ReentrancyGuard, SafeERC20, Ownable, Quote replay protection, Strict state machine

**Funding Security:** Balance-based funding (supports fee-on-transfer tokens), Over-funding prevention, Settlement time enforcement

## Project Status

### Completed
- Smart Contract: Settlement.sol with EIP-712, escrow, atomic settlement
- Backend API: RFQ, Quote, Settlement services
- Maker BOTs: 3 BOTs auto-provide quotes and auto-fund trades
- Frontend: RFQ creation, quote display, trade management
- EIP-712 Integration: Taker signs from wallet, Maker signs from backend
- Auto-refresh: Frontend auto-refreshes quotes and trades
- On-chain Status: Read status directly from contract

### In Development
- Database integration (currently in-memory)
- Transaction history page
- Token balance display
- Advanced error handling

### Planned
- Multi-chain support
- Advanced pricing strategies
- Limit orders
- Portfolio management

## Resources

- **Arc Network**: https://docs.arc.network
- **Arc Testnet Explorer**: https://testnet.arcscan.app
- **Circle Faucet**: https://faucet.circle.com
- **Contract Address**: `0x9b5a31c2B376567cEa4F07411922BbD1e7951B05` (Arc Testnet)

## Notes

**Contract Deployment:** Deployed with EIP712 name "Arc FX Settlement", version "1", chainId 5042002. ABI auto-copied after deployment.

**Settlement Schedules:** instant (120s), hourly (3600s), daily (86400s)

**Grace Period:** 3600 seconds (1 hour). Trade only expires if >1 hour after settlementTime.

**Token Addresses (Arc Testnet):**
- USDC: `0x3600000000000000000000000000000000000000`
- EURC: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`

**Known Issues:**
- In-memory storage: Backend uses Map for RFQ/Quote (will migrate to DB)
- Maker BOTs need native token (USDC) and token balance to fund trades

## License

MIT

---

**Last Updated**: 2025-01-27
