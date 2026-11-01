// Keeps the WIF Paymaster live: refreshes the WIF/ETH rate from the market and flushes fees.
//
// One run does one pass and exits, so it fits a cron (see .github/workflows/keeper.yml):
// 1. Reads WIF/ETH from the deepest WIF/ETH pool on Robinhood Chain (via DexScreener).
// 2. Moves the on-chain rate toward it, within the provider's bounds and the keeper's per-update limit.
//    Refreshes even when the price is flat, so the rate never hits its 6h expiry.
// 3. Calls flush() when enough WIF is pending, which burns the burn share and pays the treasury.
//
// Env: KEEPER_PRIVATE_KEY, RATE_PROVIDER, PAYMASTER (required); RPC_URL, WIF_TOKEN, MIN_LIQUIDITY_USD,
// REFRESH_AFTER_SEC, MIN_MOVE_BPS, FLUSH_MIN_WIF, DRY_RUN=1 (optional).
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const env = process.env
const RPC_URL = env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
const WIF = (env.WIF_TOKEN || '0x5173b8eA6923c2d40267890D45C46a3480954773').toLowerCase()
const MIN_LIQUIDITY_USD = Number(env.MIN_LIQUIDITY_USD || 20_000)
const REFRESH_AFTER_SEC = BigInt(env.REFRESH_AFTER_SEC || 3 * 3600) // well before the 6h expiry
const MIN_MOVE_BPS = BigInt(env.MIN_MOVE_BPS || 200) // update early if the price moved 2%
const FLUSH_MIN_WIF = parseUnits(env.FLUSH_MIN_WIF || '1000', 18)
const DRY_RUN = env.DRY_RUN === '1'

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

const providerAbi = parseAbi([
  'function wifPerEth() view returns (uint256)',
  'function minWifPerEth() view returns (uint256)',
  'function maxWifPerEth() view returns (uint256)',
  'function lastUpdateTimestamp() view returns (uint256)',
  'function maxKeeperChangeBps() view returns (uint256)',
  'function KEEPER_MIN_INTERVAL() view returns (uint256)',
  'function paused() view returns (bool)',
  'function setRate(uint256)',
])
const paymasterAbi = parseAbi([
  'function pendingBurn() view returns (uint128)',
  'function pendingTreasury() view returns (uint128)',
  'function flush()',
])

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))

function required(name) {
  if (!env[name]) throw new Error(`missing env ${name}`)
  return env[name]
}

/** WIF per 1 ETH (18 decimals) from the most liquid WIF/ETH pair on Robinhood Chain. */
export async function marketWifPerEth() {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${WIF}`)
  if (!res.ok) throw new Error(`price API ${res.status}`)
  const { pairs = [] } = await res.json()
  const best = pairs
    .filter((p) => p.chainId === 'robinhood' && p.baseToken?.address?.toLowerCase() === WIF)
    .filter((p) => ['ETH', 'WETH'].includes(p.quoteToken?.symbol) && (p.liquidity?.usd ?? 0) >= MIN_LIQUIDITY_USD)
    .sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0]
  if (!best) throw new Error(`no WIF/ETH pair with at least $${MIN_LIQUIDITY_USD} liquidity`)
  const ethPerWif = parseUnits(best.priceNative, 18) // priceNative = ETH per WIF
  if (ethPerWif === 0n) throw new Error('zero price')
  return { wifPerEth: 10n ** 36n / ethPerWif, pair: best.pairAddress, dex: best.dexId, liquidityUsd: best.liquidity.usd }
}

/** Where the keeper may move the rate this run, toward `market`. */
export function nextRate({ current, market, min, max, maxChangeBps }) {
  const room = maxChangeBps > 0n ? maxChangeBps - 1n : 0n // stay just inside the on-chain limit
  const up = (current * (10_000n + room)) / 10_000n
  const down = (current * (10_000n - room)) / 10_000n
  let target = market > up ? up : market < down ? down : market
  if (target > max) target = max
  if (target < min) target = min
  return target
}

async function main() {
  const rateProvider = required('RATE_PROVIDER')
  const paymaster = required('PAYMASTER')
  const account = privateKeyToAccount(required('KEEPER_PRIVATE_KEY'))
  const pub = createPublicClient({ chain, transport: http() })
  const wallet = createWalletClient({ chain, transport: http(), account })
  const read = (address, abi, functionName) => pub.readContract({ address, abi, functionName })

  const [current, min, max, last, maxChangeBps, minInterval, paused, block] = await Promise.all([
    read(rateProvider, providerAbi, 'wifPerEth'),
    read(rateProvider, providerAbi, 'minWifPerEth'),
    read(rateProvider, providerAbi, 'maxWifPerEth'),
    read(rateProvider, providerAbi, 'lastUpdateTimestamp'),
    read(rateProvider, providerAbi, 'maxKeeperChangeBps'),
    read(rateProvider, providerAbi, 'KEEPER_MIN_INTERVAL'),
    read(rateProvider, providerAbi, 'paused'),
    pub.getBlock(),
  ])
  const age = block.timestamp - last

  if (paused) {
    log('rate.skip', { reason: 'provider paused' })
  } else if (age < minInterval) {
    log('rate.skip', { reason: 'too soon', ageSec: age })
  } else {
    const market = await marketWifPerEth()
    const target = nextRate({ current, market: market.wifPerEth, min, max, maxChangeBps })
    const moveBps = ((target > current ? target - current : current - target) * 10_000n) / current
    const due = moveBps >= MIN_MOVE_BPS || age >= REFRESH_AFTER_SEC
    log('rate.check', {
      current: formatUnits(current, 18), market: formatUnits(market.wifPerEth, 18), target: formatUnits(target, 18),
      moveBps, ageSec: age, due, pair: market.pair, dex: market.dex, liquidityUsd: market.liquidityUsd,
    })
    if (due && !DRY_RUN) {
      const hash = await wallet.writeContract({ address: rateProvider, abi: providerAbi, functionName: 'setRate', args: [target] })
      const receipt = await pub.waitForTransactionReceipt({ hash })
      log('rate.updated', { hash, status: receipt.status })
    }
  }

  const [pendingBurn, pendingTreasury] = await Promise.all([
    read(paymaster, paymasterAbi, 'pendingBurn'),
    read(paymaster, paymasterAbi, 'pendingTreasury'),
  ])
  const pending = pendingBurn + pendingTreasury
  log('flush.check', { pendingBurn: formatUnits(pendingBurn, 18), pendingTreasury: formatUnits(pendingTreasury, 18) })
  if (pending >= FLUSH_MIN_WIF && !DRY_RUN) {
    const hash = await wallet.writeContract({ address: paymaster, abi: paymasterAbi, functionName: 'flush' })
    const receipt = await pub.waitForTransactionReceipt({ hash })
    log('flush.done', { hash, status: receipt.status })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log('error', { message: err.shortMessage ?? err.message })
    process.exit(1)
  })
}
