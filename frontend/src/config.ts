import { defineChain, type Address } from 'viem'
import { entryPoint07Address } from 'viem/account-abstraction'

const env = import.meta.env

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})

// Live contracts on Robinhood Chain. Override with VITE_* env vars after a redeploy.
export const PAYMASTER = (env.VITE_PAYMASTER || '0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE') as Address
export const WIF_TOKEN = (env.VITE_WIF_TOKEN || '0x5173b8eA6923c2d40267890D45C46a3480954773') as Address
export const ENTRY_POINT = entryPoint07Address
export const PAYMASTER_DEPLOY_BLOCK = BigInt(env.VITE_PAYMASTER_DEPLOY_BLOCK || '0')

// Any ERC-4337 v0.7 bundler that serves chain 4663 (Pimlico public works without a key)
export const BUNDLER_URL = env.VITE_BUNDLER_URL || 'https://public.pimlico.io/v2/4663/rpc'

// paymasterAndData gas limits: validation uses ~61k; postOp ~33k, or ~108k for the one-time setup op
export const PAYMASTER_VERIFICATION_GAS = 100_000n
export const PAYMASTER_POST_OP_GAS = 150_000n

export const EXPLORER = robinhood.blockExplorers.default.url
export const REPO_URL = 'https://github.com/Daveboycyber/Paymaster'
