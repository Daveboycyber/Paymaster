import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { ENTRY_POINT, PAYMASTER, PAYMASTER_DEPLOY_BLOCK, WIF_TOKEN } from '../config'
import { entryPointAbi, erc20Abi, paymasterAbi, rateProviderAbi } from './abi'
import { publicClient } from './wallet'

const POLL_MS = 8_000
// Rough gas of one sponsored op, for the fee shown before signing
export const SETUP_GAS = 450_000n
export const SEND_GAS = 300_000n

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
  burnBps: bigint | null
}

export function usePaymaster() {
  const [state, setState] = useState<PaymasterStatus>({ live: null, wifPerGasUnit: null, burnBps: null })
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
      setState({ live: !reason, reason, wifPerGasUnit, burnBps })
    } catch {
      setState((s) => ({ ...s, live: false, reason: 'Can’t reach Robinhood Chain right now.' }))
    }
  }, [])
  return state
}

export type Stats = { ops: number; charged: bigint; burned: bigint }

export function useStats(refreshKey: number) {
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    let live = true
    publicClient
      .getContractEvents({ address: PAYMASTER, abi: paymasterAbi, eventName: 'UserOpSponsored', fromBlock: PAYMASTER_DEPLOY_BLOCK })
      .then((logs) => {
        if (!live) return
        setStats({
          ops: logs.length,
          charged: logs.reduce((sum, l) => sum + (l.args.wifCharged ?? 0n), 0n),
          burned: logs.reduce((sum, l) => sum + (l.args.wifBurned ?? 0n), 0n),
        })
      })
      .catch(() => live && setStats(null))
    return () => {
      live = false
    }
  }, [refreshKey])
  return stats
}
