'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignTypedData, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseUnits, keccak256, toHex } from 'viem';
import { BACKEND_URL, SETTLEMENT_CONTRACT_ADDRESS, USDC_ADDRESS, EURC_ADDRESS } from '@/config/wagmi';
import SettlementContract from '@/abi/Settlement.json';
import { toast } from 'react-hot-toast';
import { apiFetchJson, apiFetch } from '@/utils/api';

// Màu xanh nhạt thống nhất cho tất cả nút khi inactive
const INACTIVE_BUTTON_COLOR = 'rgba(0, 212, 170, 0.3)';
const ACTIVE_BUTTON_COLOR = 'linear-gradient(135deg, #00D4AA 0%, #00B894 100%)';

// Block explorer base URL (Arc Testnet)
const EXPLORER_BASE_URL = 'https://testnet.arcscan.app';

interface Quote {
  id: string;
  rfqId: string;
  makerAddress: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  toAmount: string;
  rate: number;
  expiry: number;
}

export default function RFQPage() {
  
  const { address } = useAccount();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  
  const { writeContract: approveToken, data: approveHash, isPending: isApproving } = useWriteContract();
  const { isLoading: isWaitingApprove } = useWaitForTransactionReceipt({ hash: approveHash });
  const { writeContract: fundTrade, data: fundHash, isPending: isFunding } = useWriteContract();
  const { isLoading: isWaitingFund } = useWaitForTransactionReceipt({ hash: fundHash });
  const { writeContract: settleTrade, data: settleHash, isPending: isSettling } = useWriteContract();
  const { isLoading: isWaitingSettle } = useWaitForTransactionReceipt({ hash: settleHash });
  const [fromCurrency, setFromCurrency] = useState('USDC');
  const [toCurrency, setToCurrency] = useState('EURC');
  const [amount, setAmount] = useState('');
  const [tenor, setTenor] = useState<'instant' | 'hourly' | 'daily'>('instant');
  const [rfqExpiry, setRfqExpiry] = useState<'15s' | '30s' | '60s'>('15s');
  const [loading, setLoading] = useState(false);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isSettlingFromBackend, setIsSettlingFromBackend] = useState(false);
  const [showQuotesModal, setShowQuotesModal] = useState(false);
  const [isFundInitiated, setIsFundInitiated] = useState(false); // Track if user clicked Fund button
  const [acceptedTrade, setAcceptedTrade] = useState<{
    id: string;
    fromAmount: string;
    fromCurrency: string;
    toAmount: string;
    toCurrency: string;
    status: string;
    settlementTime?: number;
  } | null>(null);
  const [acceptingQuoteId, setAcceptingQuoteId] = useState<string | null>(null); // Track which quote is being accepted

  const fetchQuotes = useCallback(async () => {
    if (!rfqId) return;

    setLoadingQuotes(true);
    try {
      const data = await apiFetchJson(`${BACKEND_URL}/api/quotes/${rfqId}`);
      
      if (data.success) {
        setQuotes(data.quotes || []);
      } else {
        console.error('Failed to fetch quotes:', data.error);
      }
    } catch (error) {
      console.error('Error fetching quotes:', error);
    } finally {
      setLoadingQuotes(false);
    }
  }, [rfqId]);

  // Auto-refresh quotes khi có rfqId và autoRefresh = true
  useEffect(() => {
    if (!rfqId) {
      return;
    }

    if (!autoRefresh) {
      return;
    }

    // Fetch immediately
    fetchQuotes();

    const interval = setInterval(() => {
      fetchQuotes();
    }, 2000); // Poll mỗi 2 giây

    return () => {
      clearInterval(interval);
    };
  }, [rfqId, autoRefresh, fetchQuotes]);

  // Validation helper
  const validateRFQ = (): string | null => {
    // Rule: USDC → EURC hạn chế < 10 USDC
    if (fromCurrency === 'USDC' && toCurrency === 'EURC') {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return 'Please enter a valid amount';
      }
      if (amountNum >= 10) {
        return 'USDC to EURC trades are limited to less than 10 USDC. Please enter an amount less than 10.';
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      try {
        toast.error('Please connect wallet first');
      } catch (error) {
        console.error('❌ Error calling toast.error:', error);
      }
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Validate restrictions
    const validationError = validateRFQ();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetchJson(`${BACKEND_URL}/api/rfq`, {
        method: 'POST',
        body: JSON.stringify({
          from: { currency: fromCurrency, amount },
          to: { currency: toCurrency },
          tenor,
          takerAddress: address,
        }),
      });
      
      if (data.success) {
        const newRfqId = data.rfqId;
        // Reset quotes và set states
        setQuotes([]);
        setRfqId(newRfqId);
        setAutoRefresh(true);
        setShowQuotesModal(true);
        
        // Manually trigger first fetch after state updates
        // Use setTimeout to ensure state is set
        setTimeout(async () => {
          try {
            const data = await apiFetchJson(`${BACKEND_URL}/api/quotes/${newRfqId}`);
            if (data.success) {
              setQuotes(data.quotes || []);
            } else {
              console.error('❌ Failed to fetch quotes:', data.error);
            }
          } catch (error) {
            console.error('❌ Error in initial fetch:', error);
          }
        }, 500);
        // Không reset form để user có thể xem kết quả
      } else {
        toast.error(`Error: ${data.error}`);
      }
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptQuote = async (quoteId: string) => {
    if (!rfqId) {
      toast.error('RFQ ID not found');
      return;
    }

    if (!address) {
      toast.error('Please connect wallet first');
      return;
    }

    // Set accepting state for this specific quote
    setAcceptingQuoteId(quoteId);

    // Find the quote
    const quote = quotes.find(q => q.id === quoteId);
    if (!quote) {
      toast.error('Quote not found');
      setAcceptingQuoteId(null);
      return;
    }

    try {
      // CRITICAL: Frontend và backend phải dùng CÙNG settlementTime
      // Backend sẽ tính settlementTime và trả về, frontend dùng giá trị đó để sign
      // Hoặc frontend tính và gửi lên backend, backend dùng giá trị đó
      
      // Option 1: Frontend tính settlementTime và gửi lên backend
      // Fetch RFQ để lấy tenor
      // console.log('🔍 Fetching RFQ details...', rfqId);
      const rfqData = await apiFetchJson(`${BACKEND_URL}/api/rfq/${rfqId}`);
      if (!rfqData.success || !rfqData.rfq) {
        throw new Error('Failed to fetch RFQ details');
      }
      const rfqTenor = rfqData.rfq.tenor || tenor;
      
      // Calculate settlement time (MUST match backend logic exactly)
      const now = Math.floor(Date.now() / 1000);
      // Backend: instant = 2 * 60 = 120 seconds
      const settlementTime = rfqTenor === 'instant' ? now + (2 * 60) : rfqTenor === 'hourly' ? now + (60 * 60) : now + (24 * 60 * 60);

      // Get token addresses
      const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
      const EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
      const fromToken = quote.fromCurrency === 'USDC' ? USDC_ADDRESS : EURC_ADDRESS;
      const toToken = quote.toCurrency === 'USDC' ? USDC_ADDRESS : EURC_ADDRESS;
      const fromAmountBigInt = parseUnits(quote.fromAmount, 6);
      const toAmountBigInt = parseUnits(quote.toAmount, 6);
      
      const quoteIdBytes32 = keccak256(toHex(quoteId)) as `0x${string}`;

      // EIP-712 domain (MUST match backend exactly)
      const domain = {
        name: 'Arc FX Settlement',
        version: '1',
        chainId: 5042002, // Arc Testnet
        verifyingContract: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
      };

      // EIP-712 types
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

      // EIP-712 message (MUST match backend exactly - use original addresses, don't normalize)
      // Contract uses ECDSA.recover which returns checksummed address
      const message = {
        taker: address as `0x${string}`,
        maker: quote.makerAddress as `0x${string}`,
        fromToken: fromToken as `0x${string}`,
        toToken: toToken as `0x${string}`,
        fromAmount: fromAmountBigInt,
        toAmount: toAmountBigInt,
        settlementTime: BigInt(settlementTime),
        quoteId: quoteIdBytes32,
      };

      // Sign EIP-712 with user's wallet
      const takerSig = await signTypedDataAsync({
        domain,
        types,
        primaryType: 'Trade',
        message,
      });

      // Send to backend with taker signature AND settlementTime
      // Backend sẽ dùng settlementTime này để sign maker signature (đảm bảo giống nhau)
      const data = await apiFetchJson(`${BACKEND_URL}/api/quotes/${rfqId}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          quoteId,
          takerAddress: address,
          takerSig, // EIP-712 signature from user's wallet
          settlementTime, // Send settlementTime to backend to ensure both use same value
        }),
      });
      
      if (data.success) {
        // Lưu trade info và chuyển modal sang "Fund Trade"
        setAcceptedTrade({
          id: data.trade?.id || '',
          fromAmount: quote.fromAmount,
          fromCurrency: quote.fromCurrency,
          toAmount: quote.toAmount,
          toCurrency: quote.toCurrency,
          status: 'Pending',
          settlementTime: settlementTime, // Lưu settlementTime để check sau
        });
        setIsFundInitiated(false); // Reset fund initiated state when new trade is accepted
        setAutoRefresh(false); // Dừng auto-refresh sau khi accept
        setAcceptingQuoteId(null); // Clear accepting state
      } else {
        // Handle error response properly - backend may return error object
        const errorMsg = typeof data.error === 'string' 
          ? data.error 
          : (data.error?.message || JSON.stringify(data.error));
        console.error('❌ Backend error:', data.error);
        toast.error(`Error: ${errorMsg}`);
        setAcceptingQuoteId(null); // Clear accepting state on error
      }
    } catch (error: any) {
      console.error('❌ Error in handleAcceptQuote:', error);
      // Handle different error types properly
      let errorMsg = 'Unknown error';
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.code) {
        // Handle user rejection (e.g., MetaMask cancel)
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
          errorMsg = 'Transaction rejected by user';
        } else {
          errorMsg = `Error code: ${error.code} - ${error.message || 'See console for details'}`;
        }
      } else {
        errorMsg = JSON.stringify(error, null, 2);
      }
      toast.error(`Error accepting quote: ${errorMsg}`);
      setAcceptingQuoteId(null); // Clear accepting state on error
    }
  };

  const handleReset = () => {
    setRfqId(null);
    setQuotes([]);
    setAutoRefresh(false);
    setAmount('');
    setShowQuotesModal(false);
    setAcceptedTrade(null);
    setIsFundInitiated(false); // Reset fund initiated state
  };

  const handleApproveAndFund = async () => {
    if (!acceptedTrade || !address) {
      toast.error('Trade info or wallet address not found');
      return;
    }

    // Mark that user initiated fund process
    setIsFundInitiated(true);

    try {
      const tradeId = BigInt(acceptedTrade.id.replace('trade_', ''));
      const fromToken = acceptedTrade.fromCurrency === 'USDC' ? USDC_ADDRESS : EURC_ADDRESS;
      const amountBigInt = parseUnits(acceptedTrade.fromAmount, 6);

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
      ] as const;

      // Approve token first
      approveToken({
        address: fromToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`, amountBigInt],
      });
    } catch (error: any) {
      console.error('Error approving token:', error);
      toast.error(`Error: ${error.message}`);
      setIsFundInitiated(false); // Reset on error
    }
  };

  // Fund after approve is confirmed - ONLY if user clicked Fund button
  useEffect(() => {
    if (isFundInitiated && approveHash && !isWaitingApprove && !isApproving && acceptedTrade && !fundHash) {
      // console.log('✅ Approve confirmed, starting fund...', { approveHash, isWaitingApprove, isApproving });
      const tradeId = BigInt(acceptedTrade.id.replace('trade_', ''));
      const amountBigInt = parseUnits(acceptedTrade.fromAmount, 6);
      const SETTLEMENT_ABI = SettlementContract.abi;
      
      setTimeout(() => {
        try {
          // console.log('🚀 Calling fundTrade...', { tradeId, amountBigInt });
          fundTrade({
            address: SETTLEMENT_CONTRACT_ADDRESS as `0x${string}`,
            abi: SETTLEMENT_ABI,
            functionName: 'fundTrade',
            args: [tradeId, amountBigInt],
          });
        } catch (error: any) {
          console.error('❌ Fund error:', error);
          toast.error(`Fund error: ${error.message}`);
        }
      }, 2000); // Wait 2 seconds for approve to confirm
    }
  }, [isFundInitiated, approveHash, isWaitingApprove, isApproving, acceptedTrade, fundTrade, fundHash]);

  // Update trade status after fund - không đóng modal, chuyển sang chờ Settlement
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
      // Cập nhật status thành "Funded" và giữ modal mở để chờ Settlement
      setAcceptedTrade(prev =>
        prev
          ? {
              ...prev,
              status: 'Funded',
            }
          : prev
      );
      setIsFundInitiated(false); // Reset fund initiated state
    }
  }, [fundHash, isWaitingFund]);

  // Note: Settle logic is now handled directly in handleSettle function
  // Backend handles settlement using its private key, no user signature needed

  // Real-time countdown update for settlement time
  useEffect(() => {
    if (!acceptedTrade || acceptedTrade.status !== 'Funded' || !acceptedTrade.settlementTime) return;
    
    const interval = setInterval(() => {
      // Force re-render để update countdown
      setAcceptedTrade(prev => prev ? { ...prev } : null);
    }, 1000); // Update mỗi giây

    return () => clearInterval(interval);
  }, [acceptedTrade?.status, acceptedTrade?.settlementTime]);

  // Helper functions for settlement
  const isSettlementTimeReached = (settlementTime?: number): boolean => {
    if (!settlementTime) return false;
    const now = Math.floor(Date.now() / 1000);
    return now >= settlementTime;
  };

  const getTimeUntilSettlement = (settlementTime?: number): string => {
    if (!settlementTime) return 'Unknown';
    const now = Math.floor(Date.now() / 1000);
    const diff = settlementTime - now;
    
    if (diff <= 0) return 'Ready to settle';
    
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleSettle = async () => {
    if (!acceptedTrade || !address) {
      toast.error('Trade info or wallet address not found');
      return;
    }

    setIsSettlingFromBackend(true);
    try {
      // Gọi backend API để settle (backend sẽ dùng private key để sign transaction)
      // KHÔNG CẦN USER KÝ VÍ - backend tự động handle
      const data = await apiFetchJson(`${BACKEND_URL}/api/settlement/trade/${acceptedTrade.id}/settle`, {
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
        // Update trade status to Settled
        setAcceptedTrade(prev => prev ? { ...prev, status: 'Settled' } : null);
      } else {
        toast.error(`Error: ${data.error || 'Failed to settle trade'}`);
      }
    } catch (error: any) {
      console.error('Error settling trade:', error);
      toast.error(`Error: ${error.message || 'Failed to settle trade. Please try again.'}`);
    } finally {
      setIsSettlingFromBackend(false);
    }
  };

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* RFQ Form */}
      <div style={{ 
        padding: '1.25rem', 
        border: '1px solid rgba(255, 255, 255, 0.15)', 
        borderRadius: '8px', 
        background: '#044953',
        backdropFilter: 'blur(10px)'
      }}>
        <h2 style={{ 
          marginTop: 0,
          marginBottom: '1.5rem',
          fontFamily: "'Oxanium', sans-serif",
          fontSize: '1.5rem',
          fontWeight: 700,
          color: '#FFFFFF',
          letterSpacing: '-0.01em'
        }}>
          Create RFQ Request
        </h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
              <label style={{
                fontFamily: "'Ubuntu', sans-serif",
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.7)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                From:
              </label>
              <select 
                value={fromCurrency} 
                onChange={(e) => setFromCurrency(e.target.value)}
                style={{
                  padding: '0.75rem 0.875rem',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  background: 'rgba(1, 37, 41, 0.9)',
                  color: '#FFFFFF',
                  fontFamily: "'Ubuntu', sans-serif",
                  fontSize: '0.9375rem',
                  outline: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <option value="USDC" style={{ background: '#012529', color: '#FFFFFF' }}>USDC</option>
                <option value="EURC" style={{ background: '#012529', color: '#FFFFFF' }}>EURC</option>
              </select>
              <div style={{ 
                fontSize: '0.8125rem', 
                color: 'rgba(255, 255, 255, 0.6)', 
                marginTop: '0.25rem',
                whiteSpace: 'nowrap'
              }}>
                ⚠️ Limited to &lt; 10 USDC
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
              <label style={{
                fontFamily: "'Ubuntu', sans-serif",
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.7)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                To:
              </label>
              <select 
                value={toCurrency} 
                onChange={(e) => setToCurrency(e.target.value)}
                style={{
                  padding: '0.75rem 0.875rem',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  background: 'rgba(1, 37, 41, 0.9)',
                  color: '#FFFFFF',
                  fontFamily: "'Ubuntu', sans-serif",
                  fontSize: '0.9375rem',
                  outline: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <option value="EURC" style={{ background: '#012529', color: '#FFFFFF' }}>EURC</option>
                <option value="USDC" style={{ background: '#012529', color: '#FFFFFF' }}>USDC</option>
              </select>
            </div>

            {/* Amount on same row with From / To */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
              <label style={{
                fontFamily: "'Ubuntu', sans-serif",
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.7)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Amount:
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1.0"
                step="0.01"
                min="0"
                max={fromCurrency === 'USDC' && toCurrency === 'EURC' ? 9.99 : undefined}
                style={{
                  padding: '0.75rem 0.875rem',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  background: 'rgba(1, 37, 41, 0.9)',
                  color: '#FFFFFF',
                  fontFamily: "'Ubuntu', sans-serif",
                  fontSize: '0.9375rem',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Tenor:
            </label>
            <select 
              value={tenor} 
              onChange={(e) => setTenor(e.target.value as 'instant' | 'hourly' | 'daily')}
              style={{
                padding: '0.875rem 1rem',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                background: 'rgba(1, 37, 41, 0.8)',
                color: '#FFFFFF',
                fontFamily: "'Ubuntu', sans-serif",
                fontSize: '1rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="instant" style={{ background: '#012529', color: '#FFFFFF' }}>Instant (2 min)</option>
              <option value="hourly" style={{ background: '#012529', color: '#FFFFFF' }}>Hourly (1 hour)</option>
              <option value="daily" style={{ background: '#012529', color: '#FFFFFF' }}>Daily (1 day)</option>
            </select>
          </div>

          {/* RFQ Expiry */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              RFQ Expiry:
            </label>
            <select 
              value={rfqExpiry} 
              onChange={(e) => setRfqExpiry(e.target.value as '15s' | '30s' | '60s')}
              style={{
                padding: '0.875rem 1rem',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                background: 'rgba(1, 37, 41, 0.8)',
                color: '#FFFFFF',
                fontFamily: "'Ubuntu', sans-serif",
                fontSize: '1rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="15s" style={{ background: '#012529', color: '#FFFFFF' }}>15 seconds</option>
              <option value="30s" style={{ background: '#012529', color: '#FFFFFF' }}>30 seconds</option>
              <option value="60s" style={{ background: '#012529', color: '#FFFFFF' }}>60 seconds</option>
            </select>
          </div>

          <button 
            type="submit" 
            onClick={(e) => {
              // console.log('🟡 Button clicked!', { loading, address, amount });
              // Let form onSubmit handle it
            }}
            style={{
              padding: '0.875rem 1.25rem',
              border: 'none',
              borderRadius: '8px',
              background: (loading || rfqId) 
                ? INACTIVE_BUTTON_COLOR
                : ACTIVE_BUTTON_COLOR,
              color: '#FFFFFF',
              fontFamily: "'Ubuntu', sans-serif",
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: 1,
              transition: 'all 0.2s ease',
              marginTop: '0.5rem'
            }}
            onMouseEnter={(e) => {
              if (!loading && !rfqId) {
                e.currentTarget.style.opacity = '0.9';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && !rfqId) {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            {loading ? 'Creating...' : 'Create RFQ'}
          </button>
        </form>

      </div>
    </div>

    {/* Quotes / Fund Trade Modal */}
    {rfqId && showQuotesModal && (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
        }}
      >
        <div
          style={{
            width: '520px',
            maxWidth: '90%',
            maxHeight: '80vh',
            overflow: 'hidden',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: '#044953',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontFamily: "'Oxanium', sans-serif",
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#FFFFFF',
              }}
            >
              {acceptedTrade 
                ? (acceptedTrade.status === 'Funded' || acceptedTrade.status === 'Settled' 
                    ? 'Settlement' 
                    : 'Fund Trade')
                : `Quotes ${quotes.length > 0 ? `(${quotes.length})` : ''}`}
            </h3>
            <button
              onClick={handleReset}
              style={{
                padding: '0.5rem 0.875rem',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                background: 'rgba(1, 37, 41, 0.9)',
                color: '#FFFFFF',
                fontFamily: "'Ubuntu', sans-serif",
                fontSize: '0.8125rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(1, 37, 41, 0.9)';
              }}
            >
              Exit
            </button>
          </div>

          <div
            style={{
              padding: '1rem 1.25rem',
              overflowY: 'auto',
            }}
          >
            {acceptedTrade ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <div
                    style={{
                      fontSize: '1.2rem',
                      fontWeight: 600,
                      marginBottom: '0.5rem',
                      color: '#FFFFFF',
                      fontFamily: "'Oxanium', sans-serif",
                    }}
                  >
                    {acceptedTrade.fromAmount} {acceptedTrade.fromCurrency} → {acceptedTrade.toAmount} {acceptedTrade.toCurrency}
                  </div>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      color: 'rgba(255, 255, 255, 0.6)',
                      fontFamily: "'Ubuntu', sans-serif",
                      marginBottom: '0.25rem',
                    }}
                  >
                    ID: {acceptedTrade.id}
                  </div>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      color: 'rgba(255, 255, 255, 0.6)',
                      fontFamily: "'Ubuntu', sans-serif",
                    }}
                  >
                    Status:{' '}
                    <span
                      style={{
                        color:
                          acceptedTrade.status === 'Settled' ||
                          acceptedTrade.status === 'Funded'
                            ? '#00D4AA'
                            : '#FFA500',
                        fontWeight: 600,
                      }}
                    >
                      {acceptedTrade.status}
                    </span>
                  </div>
                  {acceptedTrade.status === 'Funded' && acceptedTrade.settlementTime && (
                    <div
                      style={{
                        fontSize: '0.875rem',
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontFamily: "'Ubuntu', sans-serif",
                        marginTop: '0.5rem',
                      }}
                    >
                      Settlement time: {getTimeUntilSettlement(acceptedTrade.settlementTime)}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '0.875rem',
                      color: 'rgba(255, 255, 255, 0.6)',
                      fontFamily: "'Ubuntu', sans-serif",
                      marginTop: '0.5rem',
                    }}
                  >
                    Taker
                  </div>
                </div>
                {acceptedTrade.status === 'Pending' ? (
                  <button
                    onClick={handleApproveAndFund}
                    style={{
                      padding: '0.875rem 1.25rem',
                      border: 'none',
                      borderRadius: '8px',
                      background: (isApproving || isFunding || isWaitingApprove || isWaitingFund)
                        ? INACTIVE_BUTTON_COLOR
                        : ACTIVE_BUTTON_COLOR,
                      color: '#FFFFFF',
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.9375rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      opacity: 1,
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isApproving && !isFunding && !isWaitingApprove && !isWaitingFund) {
                        e.currentTarget.style.opacity = '0.9';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isApproving && !isFunding && !isWaitingApprove && !isWaitingFund) {
                        e.currentTarget.style.opacity = '1';
                      }
                    }}
                  >
                    {isApproving || isWaitingApprove ? 'Approving...' : isFunding || isWaitingFund ? 'Funding...' : `Fund ${acceptedTrade.fromAmount} ${acceptedTrade.fromCurrency}`}
                  </button>
                ) : acceptedTrade.status === 'Funded' ? (
                  <button
                    onClick={handleSettle}
                    style={{
                      padding: '0.875rem 1.25rem',
                      border: 'none',
                      borderRadius: '8px',
                      background: (isSettlementTimeReached(acceptedTrade.settlementTime) && !isSettlingFromBackend)
                        ? ACTIVE_BUTTON_COLOR
                        : INACTIVE_BUTTON_COLOR,
                      color: '#FFFFFF',
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.9375rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      opacity: 1,
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (isSettlementTimeReached(acceptedTrade.settlementTime) && !isSettlingFromBackend) {
                        e.currentTarget.style.opacity = '0.9';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isSettlementTimeReached(acceptedTrade.settlementTime) && !isSettlingFromBackend) {
                        e.currentTarget.style.opacity = '1';
                      }
                    }}
                  >
                    {isSettlingFromBackend ? 'Settling...' : isSettlementTimeReached(acceptedTrade.settlementTime) ? 'Settle' : `Wait ${getTimeUntilSettlement(acceptedTrade.settlementTime)}`}
                  </button>
                ) : acceptedTrade.status === 'Settled' ? (
                  <div
                    style={{
                      padding: '0.875rem 1.25rem',
                      borderRadius: '8px',
                      background: 'rgba(0, 212, 170, 0.2)',
                      color: '#00D4AA',
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.9375rem',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    ✓ Trade Settled Successfully
                  </div>
                ) : null}
              </div>
            ) : loadingQuotes && quotes.length === 0 ? (
              <div
                style={{
                  padding: '2rem 1rem',
                  textAlign: 'center',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontFamily: "'Ubuntu', sans-serif",
                }}
              >
                ⏳ Waiting for quotes from makers...
              </div>
            ) : quotes.length === 0 ? (
              <div
                style={{
                  padding: '2rem 1rem',
                  textAlign: 'center',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontFamily: "'Ubuntu', sans-serif",
                }}
              >
                No quotes available yet. Waiting for makers to respond...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {quotes
                  .sort((a, b) => parseFloat(b.toAmount) - parseFloat(a.toAmount))
                  .map((quote) => (
                    <div
                      key={quote.id}
                      style={{
                        padding: '0.875rem',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '6px',
                        background: 'rgba(1, 37, 41, 0.75)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '1rem',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '1.05rem',
                              fontWeight: 600,
                              marginBottom: '0.25rem',
                              color: '#FFFFFF',
                              fontFamily: "'Oxanium', sans-serif",
                            }}
                          >
                            {quote.fromAmount} {quote.fromCurrency} → {quote.toAmount}{' '}
                            {quote.toCurrency}
                          </div>
                          <div
                            style={{
                              fontSize: '0.9rem',
                              color: 'rgba(255, 255, 255, 0.7)',
                              fontFamily: "'Ubuntu', sans-serif",
                            }}
                          >
                            Rate: {quote.rate.toFixed(6)}
                          </div>
                          <div
                            style={{
                              fontSize: '0.85rem',
                              color: 'rgba(255, 255, 255, 0.5)',
                              marginTop: '0.25rem',
                              fontFamily: "'Ubuntu', sans-serif",
                            }}
                          >
                            Maker: {quote.makerAddress.slice(0, 6)}...
                            {quote.makerAddress.slice(-4)}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAcceptQuote(quote.id)}
                          style={{
                            padding: '0.625rem 1rem',
                            background: (acceptingQuoteId !== null && acceptingQuoteId !== quote.id)
                              ? INACTIVE_BUTTON_COLOR
                              : ACTIVE_BUTTON_COLOR,
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontFamily: "'Ubuntu', sans-serif",
                            fontSize: '0.875rem',
                            opacity: 1,
                            transition: 'all 0.2s ease',
                            whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e) => {
                            if (acceptingQuoteId === null || acceptingQuoteId === quote.id) {
                              e.currentTarget.style.opacity = '0.9';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (acceptingQuoteId === null || acceptingQuoteId === quote.id) {
                              e.currentTarget.style.opacity = '1';
                            }
                          }}
                        >
                          {acceptingQuoteId === quote.id ? 'Signing...' : 'Accept Quote'}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

