'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/config/wagmi';
import { Toaster } from 'react-hot-toast';
import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';

const queryClient = new QueryClient();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;700&family=Ubuntu:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <title>NovaFX – RFQ FX Trading on Arc</title>
        <meta
          name="description"
          content="NovaFX is an RFQ-based FX trading app on Arc Testnet, enabling trustless USDC/EURC settlement with on-chain funding and settlement flows."
        />
        <link rel="icon" href="/nova.svg" />
      </head>
      <body>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider locale="en">
              {children}
              <Toaster position="top-right" />
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}

