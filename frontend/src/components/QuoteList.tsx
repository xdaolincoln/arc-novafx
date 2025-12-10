'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { BACKEND_URL } from '@/config/wagmi';
import { toast } from 'react-hot-toast';
import { apiFetchJson, apiFetch } from '@/utils/api';

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

export default function QuoteList() {
  const { address } = useAccount();
  const [rfqId, setRfqId] = useState('');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchQuotes = async () => {
    if (!rfqId) return;

    setLoading(true);
    try {
      const data = await apiFetchJson(`${BACKEND_URL}/api/quotes/${rfqId}`);
      
      if (data.success) {
        setQuotes(data.quotes || []);
      }
    } catch (error) {
      console.error('Error fetching quotes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptQuote = async (quoteId: string) => {
    if (!rfqId) {
      toast.error('Please enter RFQ ID first');
      return;
    }

    if (!address) {
      toast.error('Please connect wallet first');
      return;
    }

    try {
      const data = await apiFetchJson(`${BACKEND_URL}/api/quotes/${rfqId}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          quoteId,
          takerAddress: address,
        }),
      });
      
      if (data.success) {
        toast.success(`Trade created: ${data.trade?.id}. You can now fund the trade in "My Trades" section.`);
        // Refresh quotes
        fetchQuotes();
      } else {
        toast.error(`Error: ${data.error}`);
      }
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <input
          type="text"
          value={rfqId}
          onChange={(e) => setRfqId(e.target.value)}
          placeholder="Enter RFQ ID"
          style={{ width: '100%', padding: '0.5rem' }}
        />
        <button onClick={fetchQuotes} disabled={loading || !rfqId} style={{ marginTop: '0.5rem' }}>
          {loading ? 'Loading...' : 'Get Quotes'}
        </button>
      </div>

      {quotes.length > 0 && (
        <div>
          <h3>Quotes ({quotes.length})</h3>
          {quotes.map((quote) => (
            <div
              key={quote.id}
              style={{
                padding: '1rem',
                marginTop: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
              <div>Rate: {quote.rate.toFixed(6)}</div>
              <div>{quote.fromAmount} {quote.fromCurrency} → {quote.toAmount} {quote.toCurrency}</div>
              <div>Maker: {quote.makerAddress.slice(0, 6)}...{quote.makerAddress.slice(-4)}</div>
              <button onClick={() => handleAcceptQuote(quote.id)} style={{ marginTop: '0.5rem' }}>
                Accept Quote
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

