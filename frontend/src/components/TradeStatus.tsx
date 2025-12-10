'use client';

import { useEffect, useRef } from 'react';
import { useReadContract } from 'wagmi';
import SettlementContract from '@/abi/Settlement.json';

const SETTLEMENT_CONTRACT_ADDRESS = SettlementContract.address as `0x${string}`;
const SETTLEMENT_ABI = SettlementContract.abi;

// State enum values (from contract)
enum TradeState {
  Created = 0,
  FundedByTaker = 1,
  FundedByMaker = 2,
  FundedBoth = 3,
  Settled = 4,
  Cancelled = 5,
  Expired = 6,
}

interface TradeStatusProps {
  tradeId: string;
  settlementTime: number;
  onStatusUpdate?: (status: { takerFunded: boolean; makerFunded: boolean; settled: boolean }) => void;
}

export default function TradeStatus({ tradeId, settlementTime, onStatusUpdate }: TradeStatusProps) {
  const onChainTradeId = BigInt(tradeId.replace('trade_', ''));

  const { data: tradeData, isLoading, error } = useReadContract({
    address: SETTLEMENT_CONTRACT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: 'getTrade',
    args: [onChainTradeId],
    query: {
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });

  // Parse trade data from getTrade() response
  // getTrade returns: [taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, state, takerBalance, makerBalance]
  const tradeArray = tradeData as any;
  const state = tradeArray ? (tradeArray[8] as number) : TradeState.Created;
  const takerBalance = tradeArray ? (tradeArray[9] as bigint) : 0n;
  const makerBalance = tradeArray ? (tradeArray[10] as bigint) : 0n;
  const fromAmount = tradeArray ? (tradeArray[4] as bigint) : 0n;
  const toAmount = tradeArray ? (tradeArray[5] as bigint) : 0n;

  // Derive funding status from state and balances
  // Note: After settlement, escrow balances are 0, so check state first
  const settled = state === TradeState.Settled;
  const takerFunded = settled ? true : (state >= TradeState.FundedByTaker && takerBalance >= fromAmount);
  const makerFunded = settled ? true : (state >= TradeState.FundedByMaker && makerBalance >= toAmount);
  const bothFunded = state === TradeState.FundedBoth || settled;

  // Track previous status to avoid infinite loop
  const prevStatusRef = useRef<{ takerFunded: boolean; makerFunded: boolean; settled: boolean } | null>(null);

  // Update parent when status changes (only when values actually change)
  useEffect(() => {
    if (!tradeData || !onStatusUpdate) return;

    const currentStatus = { takerFunded, makerFunded, settled };
    const prevStatus = prevStatusRef.current;

    // Only update if status actually changed
    if (!prevStatus || 
        prevStatus.takerFunded !== currentStatus.takerFunded ||
        prevStatus.makerFunded !== currentStatus.makerFunded ||
        prevStatus.settled !== currentStatus.settled) {
      prevStatusRef.current = currentStatus;
      onStatusUpdate(currentStatus);
    }
  }, [tradeData, onStatusUpdate, takerFunded, makerFunded, settled]);

  const now = Math.floor(Date.now() / 1000);
  const isSettlementTimeReached = now >= settlementTime;
  const timeUntilSettlement = settlementTime - now;
  
  // Contract grace period = 1 hour (3600 seconds)
  // Trade is expired if:
  // 1. State is explicitly Expired (from contract)
  // 2. OR block.timestamp > (settlementTime + gracePeriod) - tức là quá 1 hour sau settlementTime
  const GRACE_PERIOD = 3600; // 1 hour in seconds
  const timeSinceSettlement = now - settlementTime;
  const isExpired = state === TradeState.Expired || (timeSinceSettlement > GRACE_PERIOD && !settled);

  return (
    <div style={{ marginTop: '0.5rem', fontSize: '0.9em' }}>
      {/* Only show expired warning if NOT settled */}
      {isExpired && !settled && (
        <div style={{ color: '#dc3545', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          ⚠️ Trade Expired
        </div>
      )}
      {isLoading ? (
        <div style={{ color: '#999' }}>Loading on-chain status...</div>
      ) : error ? (
        <div style={{ color: '#dc3545' }}>Error loading status: {error.message}</div>
      ) : !tradeData ? (
        <div style={{ color: '#999' }}>No on-chain data found</div>
      ) : (
        <>
          <div style={{ color: '#666' }}>
            Taker funded: {takerFunded ? '✅' : '❌'} | Maker funded: {makerFunded ? '✅' : '❌'}
          </div>
          {settled ? (
            <div style={{ marginTop: '0.25rem', color: '#28a745', fontWeight: 'bold' }}>
              ✅ Trade settled
            </div>
          ) : bothFunded ? (
            <div style={{ marginTop: '0.25rem', color: isSettlementTimeReached ? '#28a745' : '#666', fontWeight: isSettlementTimeReached ? 'bold' : 'normal' }}>
              {isSettlementTimeReached ? (
                <span style={{ color: '#28a745', fontWeight: 'bold' }}>✅ Ready to settle</span>
              ) : timeUntilSettlement > 0 ? (
                `⏳ Settlement in: ${Math.floor(timeUntilSettlement / 60)}m ${timeUntilSettlement % 60}s`
              ) : (
                <span style={{ color: '#28a745', fontWeight: 'bold' }}>✅ Ready to settle</span>
              )}
            </div>
          ) : (
            <div style={{ marginTop: '0.25rem', color: '#ffc107', fontSize: '0.85em' }}>
              ⏳ Waiting for {!takerFunded && !makerFunded ? 'both parties' : !takerFunded ? 'taker' : 'maker'} to fund
            </div>
          )}
        </>
      )}
    </div>
  );
}

