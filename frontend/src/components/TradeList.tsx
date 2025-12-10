'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { BACKEND_URL, USDC_ADDRESS, EURC_ADDRESS } from '@/config/wagmi';
import TradeStatus from './TradeStatus';
import SettlementContract from '@/abi/Settlement.json';
import { toast } from 'react-hot-toast';
import { apiFetchJson } from '@/utils/api';

const SETTLEMENT_CONTRACT_ADDRESS = SettlementContract.address as `0x${string}`;
const SETTLEMENT_ABI = SettlementContract.abi;

// Block explorer base URL (Arc Testnet)
const EXPLORER_BASE_URL = 'https://testnet.arcscan.app';

interface Trade {
  id: string;
  rfqId: string;
  quoteId: string;
  takerAddress: string;
  makerAddress: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  settlementTime: number;
  status: 'pending' | 'funded' | 'settled' | 'failed';
  txHash?: string;
}

const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

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

interface TradeWithOnChainStatus extends Trade {
  takerFunded?: boolean;
  makerFunded?: boolean;
  settled?: boolean;
}

interface TradeListProps {
  currentPage?: number;
  setCurrentPage?: (page: number) => void;
  onPaginationInfo?: (info: { totalPages: number; currentPage: number }) => void;
}

export default function TradeList({ 
  currentPage: externalCurrentPage, 
  setCurrentPage: externalSetCurrentPage,
  onPaginationInfo
}: TradeListProps = {}) {
  const { address } = useAccount();
  const [trades, setTrades] = useState<TradeWithOnChainStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentFundingTrade, setCurrentFundingTrade] = useState<string | null>(null);
  const [currentSettlingTrade, setCurrentSettlingTrade] = useState<string | null>(null);
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const itemsPerPage = 5;
  
  // Use external pagination if provided, otherwise use internal
  const currentPage = externalCurrentPage ?? internalCurrentPage;
  const setCurrentPage = externalSetCurrentPage ?? setInternalCurrentPage;

  const { writeContract: approveToken, data: approveHash, isPending: isApproving } = useWriteContract();
  const { isLoading: isWaitingApprove } = useWaitForTransactionReceipt({ hash: approveHash });

  const { writeContract: fundTrade, data: fundHash, isPending: isFunding } = useWriteContract();
  const { isLoading: isWaitingFund } = useWaitForTransactionReceipt({ hash: fundHash });

  const { writeContract: settleTrade, data: settleHash, isPending: isSettling } = useWriteContract();
  const { isLoading: isWaitingSettle } = useWaitForTransactionReceipt({ hash: settleHash });

  const fetchTrades = useCallback(async () => {
    if (!address) return;

    setLoading(true);
    try {
      const data = await apiFetchJson(`${BACKEND_URL}/api/settlement/trades?userAddress=${address}`);
      
      if (data.success) {
        setTrades(data.trades || []);
        setCurrentPage(1); // Reset to first page when trades change
      }
    } catch (error) {
      console.error('Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      fetchTrades();
      // Auto reload disabled - user can manually refresh if needed
    }
  }, [address, fetchTrades]);

  const getTokenAddress = (currency: string): `0x${string}` => {
    return currency === 'USDC' ? (USDC_ADDRESS as `0x${string}`) : (EURC_ADDRESS as `0x${string}`);
  };

  const handleApproveAndFund = async (trade: Trade) => {
    if (!address) return;

    const isTaker = trade.takerAddress.toLowerCase() === address.toLowerCase();
    const isMaker = trade.makerAddress.toLowerCase() === address.toLowerCase();

    if (!isTaker && !isMaker) {
      toast.error('You are not authorized to fund this trade');
      return;
    }

    const tokenAddress = isTaker ? getTokenAddress(trade.fromToken) : getTokenAddress(trade.toToken);
    const amount = isTaker ? trade.fromAmount : trade.toAmount;
    const amountBigInt = parseUnits(amount, 6);

    // Set current funding trade
    setCurrentFundingTrade(trade.id);

    try {
      // Step 1: Approve tokens
      approveToken({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [SETTLEMENT_CONTRACT_ADDRESS, amountBigInt],
      });
    } catch (error: any) {
      toast.error(`Approve error: ${error.message}`);
      setCurrentFundingTrade(null);
    }
  };

  // Fund after approve is confirmed
  useEffect(() => {
    if (approveHash && !isWaitingApprove && currentFundingTrade) {
      const tradeToFund = trades.find(t => t.id === currentFundingTrade);
      if (tradeToFund) {
        const tradeId = BigInt(tradeToFund.id.replace('trade_', ''));
        const isTaker = tradeToFund.takerAddress.toLowerCase() === address?.toLowerCase();
        const amount = isTaker ? tradeToFund.fromAmount : tradeToFund.toAmount;
        const amountBigInt = parseUnits(amount, 6);
        
        setTimeout(() => {
          try {
            // Contract mới: cả taker và maker đều dùng fundTrade với amountToFund
            fundTrade({
              address: SETTLEMENT_CONTRACT_ADDRESS,
              abi: SETTLEMENT_ABI,
              functionName: 'fundTrade',
              args: [tradeId, amountBigInt],
            });
          } catch (error: any) {
            toast.error(`Fund error: ${error.message}`);
            setCurrentFundingTrade(null);
          }
        }, 2000); // Wait 2 seconds for approve to confirm
      }
    }
  }, [approveHash, isWaitingApprove, currentFundingTrade]);

  // Refresh trades after fund
  useEffect(() => {
    if (fundHash && !isWaitingFund) {
      try {
        const explorerUrl = `${EXPLORER_BASE_URL}/tx/${fundHash}`;
        toast.success(
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span>Trade funded successfully!</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#00D4AA',
                textDecoration: 'underline',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              View Explorer!
            </a>
          </div>,
          { duration: 8000 }
        );
      } catch (error) {
        console.error('❌ Error calling toast.success:', error);
      }
      setCurrentFundingTrade(null);
      setTimeout(() => {
        fetchTrades();
      }, 2000);
    }
  }, [fundHash, isWaitingFund]);

  // Refresh trades after settle
  useEffect(() => {
    if (settleHash && !isWaitingSettle) {
      try {
        const explorerUrl = `${EXPLORER_BASE_URL}/tx/${settleHash}`;
        toast.success(
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span>Trade settled successfully!</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#00D4AA',
                textDecoration: 'underline',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              View Explorer!
            </a>
          </div>,
          { duration: 8000 }
        );
      } catch (error) {
        console.error('❌ Error calling toast.success:', error);
      }
      setTimeout(() => {
        fetchTrades();
      }, 2000);
      setCurrentSettlingTrade(null);
    }
  }, [settleHash, isWaitingSettle]);

  const handleSettle = async (trade: Trade) => {
    if (!address) return;

    try {
      setCurrentSettlingTrade(trade.id);
      // Option 1: Gọi backend API (recommended - backend kiểm tra settlement time)
      const data = await apiFetchJson(`${BACKEND_URL}/api/settlement/trade/${trade.id}/settle`, {
        method: 'POST',
      });
      
      if (data.success) {
        try {
          const explorerUrl = data.txHash
            ? `${EXPLORER_BASE_URL}/tx/${data.txHash}`
            : undefined;
          toast.success(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span>
                Trade settled successfully! TX:{' '}
                {data.txHash?.slice(0, 10) || 'pending'}...
              </span>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#00D4AA',
                    textDecoration: 'underline',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  View Explorer!
                </a>
              )}
            </div>,
            { duration: 8000 }
          );
        } catch (error) {
          console.error('❌ Error calling toast.success:', error);
        }
        setTimeout(() => {
          fetchTrades();
        }, 2000);
      } else {
        toast.error(`Error: ${data.error}`);
      }
    } catch (error: any) {
      // Option 2: Fallback - gọi trực tiếp smart contract
      const tradeId = BigInt(trade.id.replace('trade_', ''));
      settleTrade({
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: 'settle',
        args: [tradeId],
      });
    } finally {
      setCurrentSettlingTrade(null);
    }
  };

  const isSettlementTimeReached = (settlementTime: number): boolean => {
    const now = Math.floor(Date.now() / 1000);
    return now >= settlementTime;
  };

  const getTimeUntilSettlement = (settlementTime: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const diff = settlementTime - now;
    
    if (diff <= 0) return 'Ready to settle';
    
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes}m ${seconds}s`;
  };

  // Pagination calculations (must be before early return for hooks)
  const totalPages = Math.ceil(trades.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTrades = trades.slice(startIndex, endIndex);

  // Notify parent of pagination info (must be before early return)
  useEffect(() => {
    if (onPaginationInfo) {
      onPaginationInfo({ totalPages, currentPage });
    }
  }, [totalPages, currentPage, onPaginationInfo]);

  if (!address) {
    return <div>Please connect wallet to view trades</div>;
  }

  return (
    <div>

      {trades.length === 0 ? (
        <div style={{
          padding: '3rem',
          textAlign: 'center',
          color: 'rgba(255, 255, 255, 0.5)',
          fontFamily: "'Ubuntu', sans-serif",
          fontSize: '0.9375rem'
        }}>
          No trades found
        </div>
      ) : (
        <div style={{
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '8px',
          background: '#044953',
          overflow: 'hidden'
        }}>
          {/* Table Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
            gap: '1rem',
            padding: '0.875rem 1.25rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(1, 37, 41, 0.5)'
          }}>
            <div style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              textAlign: 'left'
            }}>
              Trading Pair
            </div>
            <div style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              textAlign: 'center'
            }}>
              Amount
            </div>
            <div style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              textAlign: 'center'
            }}>
              Status
            </div>
            <div style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              textAlign: 'center'
            }}>
              Role
            </div>
            <div style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              textAlign: 'right'
            }}>
              Actions
            </div>
          </div>

          {/* Table Rows */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {paginatedTrades.map((trade) => {
            const isTaker = trade.takerAddress.toLowerCase() === address.toLowerCase();
            const isMaker = trade.makerAddress.toLowerCase() === address.toLowerCase();
            // Use on-chain status if available, fallback to backend status
            // Note: TradeStatus component will update these via onStatusUpdate callback
            const takerFunded = trade.takerFunded ?? false;
            const makerFunded = trade.makerFunded ?? false;
            const settled = trade.settled ?? false;
            const bothFunded = takerFunded && makerFunded;
            
            // Debug: Log if both funded but still showing fund button
            if (bothFunded && (isTaker || isMaker)) {
              // console.log(`Trade ${trade.id}: bothFunded=${bothFunded}, takerFunded=${takerFunded}, makerFunded=${makerFunded}, isTaker=${isTaker}, isMaker=${isMaker}`);
            }
            // Only show expired if NOT settled and time passed and not both funded
            // Trade is expired if: quá grace period (1 hour) sau settlementTime và chưa settled
            // Contract grace period = 3600 seconds (1 hour)
            const GRACE_PERIOD = 3600;
            const now = Math.floor(Date.now() / 1000);
            const timeSinceSettlement = now - trade.settlementTime;
            const isExpired = !settled && timeSinceSettlement > GRACE_PERIOD;
            // Only show Fund button if:
            // - User is taker AND taker hasn't funded yet
            // - OR user is maker AND maker hasn't funded yet
            // - AND trade not settled and not expired
            // - AND NOT both funded (if both funded, no need to show fund button)
            const canFundTaker = isTaker && !takerFunded && !settled && !isExpired && !bothFunded;
            const canFundMaker = isMaker && !makerFunded && !settled && !isExpired && !bothFunded;
            const canSettle = bothFunded && !settled && isSettlementTimeReached(trade.settlementTime);

            return (
              <div
                key={trade.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
                  gap: '1rem',
                  padding: '1rem 1.25rem',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'transparent',
                  transition: 'background 0.2s ease',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(1, 37, 41, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Trading Pair */}
                <div>
                  <div style={{
                    fontFamily: "'Oxanium', sans-serif",
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: '#FFFFFF',
                    marginBottom: '0.25rem'
                  }}>
                    {trade.fromAmount} {trade.fromToken} → {trade.toAmount} {trade.toToken}
                  </div>
                  <div style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.5)'
                  }}>
                    ID: {trade.id.slice(-8)}
                  </div>
                </div>

                {/* Amount */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontSize: '0.875rem',
                    color: '#FFFFFF'
                  }}>
                    {trade.fromAmount} {trade.fromToken}
                  </div>
                  <div style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.6)'
                  }}>
                    → {trade.toAmount} {trade.toToken}
                  </div>
                </div>

                {/* Status */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontSize: '0.875rem',
                    color: settled 
                      ? '#00D4AA' 
                      : isExpired 
                      ? '#ff4444' 
                      : bothFunded 
                      ? '#00D4AA' 
                      : 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 500,
                    marginBottom: '0.25rem'
                  }}>
                    {settled ? 'Settled' : isExpired ? 'Expired' : bothFunded ? 'Funded' : 'Pending'}
                  </div>
                  {!settled && !isExpired && bothFunded && (
                    <div style={{
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.75rem',
                      color: 'rgba(255, 255, 255, 0.5)'
                    }}>
                      {isSettlementTimeReached(trade.settlementTime) 
                        ? 'Ready to settle' 
                        : getTimeUntilSettlement(trade.settlementTime)}
                    </div>
                  )}
                  {/* Hidden TradeStatus for on-chain updates */}
                  <div style={{ display: 'none' }}>
                    <TradeStatus
                      tradeId={trade.id}
                      settlementTime={trade.settlementTime}
                      onStatusUpdate={(status: { takerFunded: boolean; makerFunded: boolean; settled: boolean }) => {
                        setTrades(prev => prev.map(t => 
                          t.id === trade.id 
                            ? { ...t, takerFunded: status.takerFunded, makerFunded: status.makerFunded, settled: status.settled }
                            : t
                        ));
                      }}
                    />
                  </div>
                </div>

                {/* Role */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontSize: '0.875rem',
                    color: isTaker ? '#00D4AA' : isMaker ? '#00B894' : 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 500
                  }}>
                    {isTaker ? 'Taker' : isMaker ? 'Maker' : 'Unknown'}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {canFundTaker && (
                    <button
                      onClick={() => handleApproveAndFund(trade)}
                      disabled={isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id}
                      style={{
                        padding: '0.5rem 0.875rem',
                        border: 'none',
                        borderRadius: '6px',
                        background: 'linear-gradient(135deg, #00D4AA 0%, #00B894 100%)',
                        color: '#FFFFFF',
                        fontFamily: "'Ubuntu', sans-serif",
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        cursor: (isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id) ? 'not-allowed' : 'pointer',
                        opacity: (isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id) ? 0.5 : 1,
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (!(isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id)) {
                          e.currentTarget.style.opacity = '0.9';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!(isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id)) {
                          e.currentTarget.style.opacity = '1';
                        }
                      }}
                    >
                      {isApproving || isWaitingApprove
                        ? 'Approving...'
                        : isFunding || isWaitingFund
                        ? 'Funding...'
                        : `Fund ${trade.fromAmount} ${trade.fromToken}`}
                    </button>
                  )}

                  {canFundMaker && (
                    <button
                      onClick={() => handleApproveAndFund(trade)}
                      disabled={isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id}
                      style={{
                        padding: '0.5rem 0.875rem',
                        border: 'none',
                        borderRadius: '6px',
                        background: 'linear-gradient(135deg, #00D4AA 0%, #00B894 100%)',
                        color: '#FFFFFF',
                        fontFamily: "'Ubuntu', sans-serif",
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        cursor: (isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id) ? 'not-allowed' : 'pointer',
                        opacity: (isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id) ? 0.5 : 1,
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (!(isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id)) {
                          e.currentTarget.style.opacity = '0.9';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!(isApproving || isWaitingApprove || isFunding || isWaitingFund || currentFundingTrade === trade.id)) {
                          e.currentTarget.style.opacity = '1';
                        }
                      }}
                    >
                      {isApproving || isWaitingApprove
                        ? 'Approving...'
                        : isFunding || isWaitingFund
                        ? 'Funding...'
                        : `Fund ${trade.toAmount} ${trade.toToken}`}
                    </button>
                  )}

                  {canSettle && (
                    <button
                      onClick={() => handleSettle(trade)}
                      disabled={
                        isSettling ||
                        isWaitingSettle ||
                        currentSettlingTrade === trade.id
                      }
                      style={{
                        padding: '0.5rem 0.875rem',
                        border: 'none',
                        borderRadius: '6px',
                        background: 'linear-gradient(135deg, #00D4AA 0%, #00B894 100%)',
                        color: '#FFFFFF',
                        fontFamily: "'Ubuntu', sans-serif",
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        cursor:
                          isSettling ||
                          isWaitingSettle ||
                          currentSettlingTrade === trade.id
                            ? 'not-allowed'
                            : 'pointer',
                        opacity:
                          isSettling ||
                          isWaitingSettle ||
                          currentSettlingTrade === trade.id
                            ? 0.5
                            : 1,
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (
                          !(
                            isSettling ||
                            isWaitingSettle ||
                            currentSettlingTrade === trade.id
                          )
                        ) {
                          e.currentTarget.style.opacity = '0.9';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (
                          !(
                            isSettling ||
                            isWaitingSettle ||
                            currentSettlingTrade === trade.id
                          )
                        ) {
                          e.currentTarget.style.opacity = '1';
                        }
                      }}
                    >
                      {isSettling ||
                      isWaitingSettle ||
                      currentSettlingTrade === trade.id
                        ? 'Settling...'
                        : 'Settle'}
                    </button>
                  )}

                  {isExpired && !settled && (
                    <div style={{
                      padding: '0.5rem 0.875rem',
                      borderRadius: '6px',
                      background: 'rgba(255, 68, 68, 0.2)',
                      color: '#ff4444',
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.8125rem',
                      fontWeight: 500
                    }}>
                      Expired
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

