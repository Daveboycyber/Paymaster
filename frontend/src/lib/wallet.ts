import { createPublicClient, createWalletClient, custom, http, toHex, type Account, type Address, type Chain, type LocalAccount, type Transport, type WalletClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { robinhood, EXPLORER } from '../config'

export const publicClient = createPublicClient({ chain: robinhood, transport: http() })

// Who signs for the smart account: an extension wallet, or a key kept in this browser
export type Owner =
  | { kind: 'wallet'; address: Address; client: WalletClient<Transport, Chain, Account> }
  | { kind: 'browser'; address: Address; account: LocalAccount }

const BROWSER_KEY = 'wif-paymaster:browser-key'

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
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

export const hasExtensionWallet = () => typeof window !== 'undefined' && !!window.ethereum

export async function connectWallet(): Promise<Owner> {
  const eth = window.ethereum
  if (!eth) throw new Error('No browser wallet found. Use a browser account instead.')
  const [address] = await eth.request({ method: 'eth_requestAccounts' })
  await switchToRobinhood(eth)
  const client = createWalletClient({ account: address, chain: robinhood, transport: custom(eth) })
  return { kind: 'wallet', address, client }
}

async function switchToRobinhood(eth: NonNullable<Window['ethereum']>) {
  const chainId = toHex(robinhood.id)
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) throw err
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId,
        chainName: robinhood.name,
        nativeCurrency: robinhood.nativeCurrency,
        rpcUrls: [...robinhood.rpcUrls.default.http],
        blockExplorerUrls: [EXPLORER],
      }],
    })
  }
}
