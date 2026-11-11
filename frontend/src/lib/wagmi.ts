import { createConfig, http, injected } from 'wagmi'
import { robinhood } from '../config'

// Wallets announce themselves over EIP-6963 (MetaMask, Rabby, …); injected() covers older ones that only set window.ethereum.
// WagmiProvider remembers the last wallet, reconnects without a prompt, and follows account switches and disconnects.
export const wagmiConfig = createConfig({
  chains: [robinhood],
  connectors: [injected()],
  transports: { [robinhood.id]: http() },
  multiInjectedProviderDiscovery: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
