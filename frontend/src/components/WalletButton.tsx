'use client';

import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { arcTestnet } from '@/config/wagmi';
import { toast } from 'react-hot-toast';

export default function WalletButton() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [isAddingNetwork, setIsAddingNetwork] = useState(false);

  // Function to add network manually (for MetaMask, OKX and other wallets)
  const addArcTestnetNetwork = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      toast.error('Wallet not found. Please install a wallet extension.');
      return;
    }

    setIsAddingNetwork(true);
    
    // Format chain ID correctly (hex format required by MetaMask)
    const chainIdHex = `0x${arcTestnet.id.toString(16)}`;
    
    // Network parameters - MetaMask requires specific format
    // MetaMask expects rpcUrls as array of strings, not nested object
    const rpcUrl = arcTestnet.rpcUrls.default.http[0] || 'https://rpc.testnet.arc.network';
    const blockExplorerUrl = arcTestnet.blockExplorers?.default?.url || 'https://explorer.testnet.arc.network';
    
    const networkParams = {
      chainId: chainIdHex,
      chainName: arcTestnet.name,
      nativeCurrency: {
        name: arcTestnet.nativeCurrency.name,
        symbol: arcTestnet.nativeCurrency.symbol,
        decimals: arcTestnet.nativeCurrency.decimals,
      },
      rpcUrls: [rpcUrl], // Must be array of strings
      blockExplorerUrls: [blockExplorerUrl], // Must be array of strings
    };

    console.log('Attempting to add network with params:', networkParams);

    try {
      // Try wallet_addEthereumChain (MetaMask standard)
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [networkParams],
      });
      
      console.log('Network added successfully, switching...');
      
      // Wait a bit before switching
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // After adding, try to switch
      await switchChain({ chainId: arcTestnet.id });
      toast.success('Arc Testnet added and switched successfully');
    } catch (error: any) {
      console.error('Error adding network:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        data: error.data,
      });

      if (error.code === 4902 || error.message?.includes('already exists') || error.message?.includes('already added')) {
        // Network already exists, try to switch
        console.log('Network already exists, switching...');
        try {
          await switchChain({ chainId: arcTestnet.id });
          toast.success('Switched to Arc Testnet');
        } catch (switchError: any) {
          console.error('Switch error:', switchError);
          toast.error('Failed to switch network. Please switch manually in your wallet.');
        }
      } else if (error.code === 4001 || error.message?.includes('User rejected') || error.message?.includes('user rejected')) {
        // User rejected
        toast.error('Network addition cancelled. Please add Arc Testnet manually.');
      } else {
        // Show detailed error with manual instructions
        const networkInfo = `
Network Name: ${arcTestnet.name}
Chain ID: ${arcTestnet.id} (Hex: ${chainIdHex})
RPC URL: ${arcTestnet.rpcUrls.default.http[0]}
Currency Symbol: ${arcTestnet.nativeCurrency.symbol}
Block Explorer: ${arcTestnet.blockExplorers?.default?.url || 'https://explorer.testnet.arc.network'}
        `.trim();

        toast.error(
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '400px' }}>
            <span style={{ fontWeight: 'bold' }}>Failed to add network automatically</span>
            <div style={{ fontSize: '0.75rem', opacity: 0.9, fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{networkInfo}</pre>
            </div>
            <span style={{ fontSize: '0.875rem', opacity: 0.8 }}>
              Error: {error.message || error.code || 'Unknown error'}. Please copy the information above and add Arc Testnet manually in your wallet settings.
            </span>
          </div>,
          { duration: 15000 }
        );
      }
    } finally {
      setIsAddingNetwork(false);
    }
  };

  useEffect(() => {
    if (isConnected && chainId !== arcTestnet.id) {
      // Ví đã kết nối nhưng không phải Arc testnet
      const handleNetworkSwitch = async () => {
        try {
          // Thử switch trước
          await switchChain({ chainId: arcTestnet.id });
          toast.success('Switched to Arc Testnet');
        } catch (error: any) {
          // Nếu switch thất bại (network chưa được add), thử add network
          console.log('Switch failed, trying to add network...', error);
          
          // Đợi một chút để đảm bảo wallet ready
          setTimeout(() => {
            addArcTestnetNetwork();
          }, 500);
        }
      };
      
      // Tự động switch/add sau 500ms để đảm bảo wallet đã ready
      const timeoutId = setTimeout(handleNetworkSwitch, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isConnected, chainId, switchChain]);

  return <ConnectButton />;
}

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

