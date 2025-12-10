export interface RFQRequest {
  from: {
    currency: string; // 'USDC', 'EURC'
    amount: string;
  };
  to: {
    currency: string;
  };
  tenor: 'instant' | 'hourly' | 'daily';
  takerAddress: string;
}

export interface Quote {
  id: string;
  rfqId: string;
  makerAddress: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  toAmount: string;
  rate: number;
  expiry: number; // timestamp
  selected?: boolean;
}

export interface Trade {
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

export interface SettlementSchedule {
  instant: number; // 30 minutes in seconds
  hourly: number; // 1 hour in seconds
  daily: number; // 1 day in seconds
}

