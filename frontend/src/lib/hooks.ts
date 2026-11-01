import { useCallback, useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import { ENTRY_POINT, PAYMASTER, PAYMASTER_DEPLOY_BLOCK, WIF_TOKEN } from '../config'
import { entryPointAbi, erc20Abi, paymasterAbi, rateProviderAbi } from './abi'
import { publicClient } from './wallet'

const POLL_MS = 8_000
// Rough gas of one sponsored op (incl. the paymaster's postOp overhead), for the fee shown before signing
export const SETUP_GAS = 450_000n
export const SEND_GAS = 300_000n
// The public RPC serves eth_getLogs over a few million blocks; the chain makes ~820k blocks a day
const LOG_CHUNK = 2_000_000n

function usePoll(fn: () => Promise<void>, deps: unknown[]) {
  const run = useCallback(fn, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run()
    const id = setInterval(run, POLL_MS)
    return () => clearInterval(id)
  }, [run])
  return run
}

export type Balances = { eth: bigint | null; wif: bigint | null; allowance: bigint | null; ownerWif: bigint | null }

export function useBalances(account?: Address, walletOwner?: Address) {
  const [state, setState] = useState<Balances>({ eth: null, wif: null, allowance: null, ownerWif: null })
  const refresh = usePoll(async () => {
    if (!account) return setState({ eth: null, wif: null, allowance: null, ownerWif: null })
    try {
      const [eth, wif, allowance, ownerWif] = await Promise.all([
        publicClient.getBalance({ address: account }),
        publicClient.readContract({ address: WIF_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
        publicClient.readContract({ address: WIF_TOKEN, abi: erc20Abi, functionName: 'allowance', args: [account, PAYMASTER] }),
        walletOwner
          ? publicClient.readContract({ address: WIF_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [walletOwner] })
          : Promise.resolve(null),
      ])
      setState({ eth, wif, allowance, ownerWif })
    } catch {
      // keep the last good values; the next poll retries
    }
  }, [account, walletOwner])
  return { ...state, refresh }
}

export type PaymasterStatus = {
  live: boolean | null // null while loading
  reason?: string
  wifPerGasUnit: bigint | null // WIF per gas at current gas price, with premium
  gasPrice: bigint | null
  burnBps: bigint | null
}

export function usePaymaster() {
  const [state, setState] = useState<PaymasterStatus>({ live: null, wifPerGasUnit: null, gasPrice: null, burnBps: null })
  usePoll(async () => {
    try {
      const [rateProvider, burnBps, deposit, gasPrice] = await Promise.all([
        publicClient.readContract({ address: PAYMASTER, abi: paymasterAbi, functionName: 'rateProvider' }),
        publicClient.readContract({ address: PAYMASTER, abi: paymasterAbi, functionName: 'burnBps' }),
        publicClient.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: 'balanceOf', args: [PAYMASTER] }),
        publicClient.getGasPrice(),
      ])
      const healthy = await publicClient.readContract({ address: rateProvider, abi: rateProviderAbi, functionName: 'isHealthy' })
      // quoteWif only exists on the fixed paymaster; price a million gas units to keep precision
      const perMillion = await publicClient
        .readContract({ address: PAYMASTER, abi: paymasterAbi, functionName: 'quoteWif', args: [gasPrice * 1_000_000n] })
        .catch(() => null)
      const wifPerGasUnit = perMillion == null ? null : perMillion / 1_000_000n
      const reason = !healthy
        ? 'The $WIF price is out of date, so the paymaster is not accepting transactions right now.'
        : perMillion == null
          ? 'This paymaster is the old version. Point VITE_PAYMASTER at the redeployed contract.'
          : deposit < gasPrice * SETUP_GAS
            ? 'The paymaster is out of ETH to sponsor gas.'
            : undefined
      setState({ live: !reason, reason, wifPerGasUnit, gasPrice, burnBps })
    } catch {
      setState((s) => ({ ...s, live: false, reason: 'Can’t reach Robinhood Chain right now.' }))
    }
  }, [])
  return state
}

/** When this account can next use the paymaster, if a daily limit is reached; null if it can now. */
export function useLimitReset(account: Address | undefined, gasPrice: bigint | null, refreshKey: number) {
  const [resetAt, setResetAt] = useState<Date | null>(null)
  usePoll(async () => {
    if (!account || gasPrice == null) return setResetAt(null)
    try {
      const read = <T,>(functionName: string, args?: readonly unknown[]) =>
        publicClient.readContract({ address: PAYMASTER, abi: paymasterAbi, functionName, args } as never) as Promise<T>
      const [[accountSpent, accountStart], accountLimit, [dailySpent, dailyStart], dailyLimit] = await Promise.all([
        read<readonly [bigint, bigint]>('accountWindow', [account]),
        read<bigint>('accountDailyLimitWei'),
        read<readonly [bigint, bigint]>('daily'),
        read<bigint>('dailyLimitWei'),
      ])
      const cost = gasPrice * SEND_GAS
      const now = BigInt(Math.floor(Date.now() / 1000))
      const blockedUntil = (spent: bigint, start: bigint, limit: bigint) =>
        spent + cost > limit && start + 86_400n > now ? start + 86_400n : 0n
      const until = [blockedUntil(accountSpent, accountStart, accountLimit), blockedUntil(dailySpent, dailyStart, dailyLimit)]
        .reduce((a, b) => (b > a ? b : a), 0n)
      setResetAt(until > 0n ? new Date(Number(until) * 1000) : null)
    } catch {
      setResetAt(null) // old paymaster without limits
    }
  }, [account, gasPrice, refreshKey])
  return resetAt
}

export type Stats = { ops: bigint; charged: bigint; burned: bigint; queuedBurn: bigint }

export function useStats(refreshKey: number) {
  const [stats, setStats] = useState<Stats | null>(null)
  usePoll(async () => {
    try {
      const [[ops, charged, burned], queuedBurn] = await Promise.all([
        publicClient.readContract({ address: PAYMASTER, abi: paymasterAbi, functionName: 'totals' }),
        publicClient.readContract({ address: PAYMASTER, abi: paymasterAbi, functionName: 'pendingBurn' }),
      ])
      setStats({ ops, charged, burned, queuedBurn })
    } catch {
      setStats(null) // old paymaster without totals()
    }
  }, [refreshKey])
  return stats
}

export type HistoryItem = { txHash: Hex; wifCharged: bigint; wifBurned: bigint; blockNumber: bigint }

/** This account's sponsored ops, newest first, read from UserOpSponsored events in chunks. */
export function useHistory(account: Address | undefined, refreshKey: number) {
  const [items, setItems] = useState<HistoryItem[]>([])
  useEffect(() => {
    if (!account) return setItems([])
    let live = true
    ;(async () => {
      const latest = await publicClient.getBlockNumber()
      const ranges: [bigint, bigint][] = []
      for (let from = PAYMASTER_DEPLOY_BLOCK; from <= latest; from += LOG_CHUNK) {
        ranges.push([from, from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n])
      }
      const chunks = await Promise.all(
        ranges.map(([fromBlock, toBlock]) =>
          publicClient.getContractEvents({
            address: PAYMASTER, abi: paymasterAbi, eventName: 'UserOpSponsored', args: { sender: account }, fromBlock, toBlock,
          }),
        ),
      )
      if (!live) return
      setItems(
        chunks.flat().reverse().map((log) => ({
          txHash: log.transactionHash,
          wifCharged: log.args.wifCharged ?? 0n,
          wifBurned: log.args.wifBurned ?? 0n,
          blockNumber: log.blockNumber,
        })),
      )
    })().catch(() => {}) // history is a nice-to-have; the session receipts still show
    return () => {
      live = false
    }
  }, [account, refreshKey])
  return items
}
