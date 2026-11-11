import { createPublicClient, createWalletClient, custom, http, type Account, type Address, type Chain, type EIP1193Provider, type LocalAccount, type Transport, type WalletClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { robinhood } from '../config'

export const publicClient = createPublicClient({ chain: robinhood, transport: http() })

// Who signs for the smart account: an extension wallet, or a key kept in this browser
export type Owner =
  | { kind: 'wallet'; address: Address; client: WalletClient<Transport, Chain, Account> }
  | { kind: 'browser'; address: Address; account: LocalAccount }

const BROWSER_KEY = 'wif-paymaster:browser-key'

export function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private window: the account lives until the tab closes
  }
}

let sessionKey: `0x${string}` | null = null

export function browserOwner(): Owner {
  let key = (read(BROWSER_KEY) as `0x${string}` | null) ?? sessionKey
  if (!key) {
    key = generatePrivateKey()
    write(BROWSER_KEY, key)
  }
  sessionKey = key
  const account = privateKeyToAccount(key)
  return { kind: 'browser', address: account.address, account }
}

export function browserKey() {
  return read(BROWSER_KEY) ?? sessionKey
}

/** A wallet the user connected through wagmi. Builds the client locally: no wallet round trip. */
export function walletOwner(address: Address, provider: EIP1193Provider): Owner {
  const client = createWalletClient({ account: address, chain: robinhood, transport: custom(provider) })
  return { kind: 'wallet', address, client }
}

const unknownChain = (err: unknown): boolean => {
  for (let e = err as { code?: number; message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === 4902 || /unrecognized chain|wallet_addEthereumChain/i.test(e.message ?? '')) return true
  }
  return false
}

/** Only sending a transaction from the wallet needs Robinhood Chain; signing for the smart account works on any network. */
export async function ensureRobinhood(client: WalletClient<Transport, Chain, Account>) {
  if ((await client.getChainId()) === robinhood.id) return
  try {
    await client.switchChain({ id: robinhood.id })
  } catch (err) {
    if (!unknownChain(err)) throw err
    await client.addChain({ chain: robinhood })
  }
}

export const hasExtensionWallet = () => typeof window !== 'undefined' && !!window.ethereum
