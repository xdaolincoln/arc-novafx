'use client';

import { useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { arcTestnet } from '@/config/wagmi';
import { toast } from 'react-hot-toast';

export default function WalletButton() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (isConnected && chainId !== arcTestnet.id) {
      // Ví đã kết nối nhưng không phải Arc testnet - tự động switch
      const switchToArcTestnet = async () => {
        try {
          await switchChain({ chainId: arcTestnet.id });
          toast.success('Switched to Arc Testnet');
        } catch (error: any) {
          // Nếu switch thất bại (ví dụ: user reject hoặc network chưa được add)
          toast.error(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span>Please switch to Arc Testnet (Chain ID: {arcTestnet.id})</span>
              <span style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                If Arc Testnet is not in your wallet, please add it manually.
              </span>
            </div>,
            { duration: 10000 }
          );
        }
      };
      
      // Tự động switch sau 500ms để đảm bảo wallet đã ready
      const timeoutId = setTimeout(switchToArcTestnet, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isConnected, chainId, switchChain]);

  return <ConnectButton />;
}

