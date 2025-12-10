'use client';

import { useState, useEffect } from 'react';
import WalletButton from '@/components/WalletButton';
import RFQPage from '@/components/RFQPage';
import TradeList from '@/components/TradeList';
import FXChart from '@/components/FXChart';
import { BACKEND_URL } from '@/config/wagmi';
import { toast } from 'react-hot-toast';

type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export default function Home() {
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [historyCurrentPage, setHistoryCurrentPage] = useState(1);
  const [historyPaginationInfo, setHistoryPaginationInfo] = useState<{ totalPages: number; currentPage: number } | null>(null);

  // Fetch current USDC/EURC rate from CoinGecko
  const fetchCurrentRate = async () => {
    try {
      setRateLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/price/USDC/EURC`);
      const data = await response.json();
      
      if (data.success) {
        setCurrentRate(data.rate);
      }
    } catch (error) {
      console.error('Error fetching current rate:', error);
    } finally {
      setRateLoading(false);
    }
  };

  // Fetch rate on mount and refresh every 30 seconds
  useEffect(() => {
    fetchCurrentRate();
    const interval = setInterval(fetchCurrentRate, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#012529',
      }}
    >
      {/* Header full-width */}
      <header
        style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div
          style={{
            maxWidth: '80%',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '2rem',
          }}
        >
          {/* Left: Logo + Navigation */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2.5rem',
              flex: 1,
            }}
          >
            {/* Logo + Title */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <img
                src="/nova.svg"
                alt="NovaFX logo"
                style={{ width: '32px', height: '32px' }}
              />
              <h1
                style={{
                  fontFamily: "'Oxanium', sans-serif",
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                NovaFX
              </h1>
            </div>
          </div>

          {/* Right: Wallet Button */}
          <div>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Main content (80% width, centered) */}
      <main
        style={{
          maxWidth: '80%',
          margin: '0 auto',
          padding: '2rem 1rem 0',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Top Row: Create RFQ Request + Chart */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '4fr 6fr',
              gap: '2rem',
              alignItems: 'stretch',
            }}
          >
            {/* Left Column: Create RFQ Request + Quotes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <RFQPage />
            </div>

            {/* Right Column: Chart Card */}
            <div
              style={{
                padding: '1.25rem',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                background: '#044953',
                height: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.5rem',
                }}
              >
                <h2
                  style={{
                    fontFamily: "'Oxanium', sans-serif",
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: '#FFFFFF',
                    letterSpacing: '-0.02em',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <span>USDC/EURC</span>
                  {currentRate !== null && !rateLoading && (
                    <span
                      style={{
                        fontFamily: "'Oxanium', sans-serif",
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        color: '#FFFFFF',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {currentRate.toFixed(4)}
                    </span>
                  )}
                  {rateLoading && (
                    <span
                      style={{
                        fontFamily: "'Oxanium', sans-serif",
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        color: 'rgba(255, 255, 255, 0.5)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Loading...
                    </span>
                  )}
                </h2>

                {/* Timeframe buttons */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['5m', '15m', '30m', '1h', '4h', '1d'] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      style={{
                        padding: '0.4375rem 0.625rem',
                        border: `1px solid ${
                          timeframe === tf ? '#00D4AA' : 'rgba(255, 255, 255, 0.2)'
                        }`,
                        borderRadius: '4px',
                        background:
                          timeframe === tf ? 'rgba(0, 212, 170, 0.2)' : 'rgba(1, 37, 41, 0.7)',
                        color: timeframe === tf ? '#00D4AA' : 'rgba(255, 255, 255, 0.7)',
                        fontFamily: "'Ubuntu', sans-serif",
                        fontSize: '0.8125rem',
                        fontWeight: timeframe === tf ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (timeframe !== tf) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                          e.currentTarget.style.color = '#FFFFFF';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (timeframe !== tf) {
                          e.currentTarget.style.background = 'rgba(1, 37, 41, 0.6)';
                          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                        }
                      }}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {/* FX Chart */}
              <div
                style={{
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  background: 'rgba(1, 37, 41, 0.5)',
                  marginBottom: 0,
                  overflow: 'hidden',
                  flex: 1,
                  minHeight: '260px',
                }}
              >
                <FXChart timeframe={timeframe} currentRate={currentRate} />
              </div>
            </div>
          </div>

          {/* Bottom Row: History Card (Full Width) */}
          <div
            style={{
              padding: '1.25rem',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              background: '#044953',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <h2
                style={{
                  fontFamily: "'Oxanium', sans-serif",
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                History
              </h2>
              {historyPaginationInfo && historyPaginationInfo.totalPages > 1 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <button
                    onClick={() => setHistoryCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={historyCurrentPage === 1}
                    style={{
                      padding: '0.5rem 1rem',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '6px',
                      background: historyCurrentPage === 1 ? 'rgba(1, 37, 41, 0.5)' : 'rgba(1, 37, 41, 0.9)',
                      color: '#FFFFFF',
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      cursor: historyCurrentPage === 1 ? 'not-allowed' : 'pointer',
                      opacity: historyCurrentPage === 1 ? 0.5 : 1,
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (historyCurrentPage !== 1) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (historyCurrentPage !== 1) {
                        e.currentTarget.style.background = 'rgba(1, 37, 41, 0.9)';
                      }
                    }}
                  >
                    Previous
                  </button>

                  <div style={{
                    fontFamily: "'Ubuntu', sans-serif",
                    fontSize: '0.875rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    padding: '0 1rem',
                  }}>
                    Page {historyCurrentPage} of {historyPaginationInfo.totalPages}
                  </div>

                  <button
                    onClick={() => setHistoryCurrentPage(prev => Math.min(historyPaginationInfo.totalPages, prev + 1))}
                    disabled={historyCurrentPage === historyPaginationInfo.totalPages}
                    style={{
                      padding: '0.5rem 1rem',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '6px',
                      background: historyCurrentPage === historyPaginationInfo.totalPages ? 'rgba(1, 37, 41, 0.5)' : 'rgba(1, 37, 41, 0.9)',
                      color: '#FFFFFF',
                      fontFamily: "'Ubuntu', sans-serif",
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      cursor: historyCurrentPage === historyPaginationInfo.totalPages ? 'not-allowed' : 'pointer',
                      opacity: historyCurrentPage === historyPaginationInfo.totalPages ? 0.5 : 1,
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (historyCurrentPage !== historyPaginationInfo.totalPages) {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (historyCurrentPage !== historyPaginationInfo.totalPages) {
                        e.currentTarget.style.background = 'rgba(1, 37, 41, 0.9)';
                      }
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
            <TradeList 
              currentPage={historyCurrentPage}
              setCurrentPage={setHistoryCurrentPage}
              onPaginationInfo={setHistoryPaginationInfo}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

