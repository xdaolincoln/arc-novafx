'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { BACKEND_URL } from '@/config/wagmi';
import { toast } from 'react-hot-toast';

export default function RFQForm() {
  const { address } = useAccount();
  const [fromCurrency, setFromCurrency] = useState('USDC');
  const [toCurrency, setToCurrency] = useState('EURC');
  const [amount, setAmount] = useState('');
  const [tenor, setTenor] = useState<'instant' | 'hourly' | 'daily'>('instant');
  const [loading, setLoading] = useState(false);
  const [rfqId, setRfqId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!address) {
      toast.error('Please connect wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/rfq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { currency: fromCurrency, amount },
          to: { currency: toCurrency },
          tenor,
          takerAddress: address,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        setRfqId(data.rfqId);
        toast.success(`RFQ created: ${data.rfqId}`);
        // Reset form
        setAmount('');
      } else {
        toast.error(`Error: ${data.error}`);
      }
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <label>From:</label>
        <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)}>
          <option value="USDC">USDC</option>
          <option value="EURC">EURC</option>
        </select>
      </div>

      <div>
        <label>To:</label>
        <select value={toCurrency} onChange={(e) => setToCurrency(e.target.value)}>
          <option value="EURC">EURC</option>
          <option value="USDC">USDC</option>
        </select>
      </div>

      <div>
        <label>Amount:</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="1.0"
          step="0.01"
          min="0"
        />
      </div>

      <div>
        <label>Tenor:</label>
        <select value={tenor} onChange={(e) => setTenor(e.target.value as 'instant' | 'hourly' | 'daily')}>
          <option value="instant">Instant (2 min)</option>
          <option value="hourly">Hourly (1 hour)</option>
          <option value="daily">Daily (1 day)</option>
        </select>
      </div>

      <button type="submit" disabled={loading || !address}>
        {loading ? 'Creating...' : 'Create RFQ'}
      </button>

      {rfqId && (
        <div style={{ padding: '0.5rem', background: '#e0e0e0', borderRadius: '4px' }}>
          RFQ ID: {rfqId}
        </div>
      )}
    </form>
  );
}

