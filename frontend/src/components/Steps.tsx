import { useState, type FormEvent } from 'react'
import { encodeFunctionData, parseUnits, type Address } from 'viem'
import { WIF_TOKEN } from '../config'
import { erc20Abi } from '../lib/abi'
import { fmtWif, isAddress } from '../lib/format'
import { SEND_GAS, SETUP_GAS, type Balances, type PaymasterStatus } from '../lib/hooks'
import { enableWifGas, friendlyError, sendWif, type SmartClient, type Sponsored } from '../lib/smart'
import type { Owner } from '../lib/wallet'
import { publicClient } from '../lib/wallet'
import { Button, Copy, Notice } from './ui'

type StepProps = {
  client: SmartClient
  balances: Balances & { refresh: () => Promise<void> }
  paymaster: PaymasterStatus
  onDone: (result: Sponsored & { label: string }) => void
}

function parseAmount(text: string) {
  try {
    const value = parseUnits(text.trim() || '0', 18)
    return value > 0n ? value : null
  } catch {
    return null
  }
}

const feeFor = (paymaster: PaymasterStatus, gas: bigint) =>
  paymaster.wifPerGasUnit == null ? null : paymaster.wifPerGasUnit * gas

export function FundStep({ client, owner, balances }: { client: SmartClient; owner: Owner; balances: StepProps['balances'] }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<string | false>(false)
  const [error, setError] = useState('')
  const address = client.account.address

  const move = async (e: FormEvent) => {
    e.preventDefault()
    if (owner.kind !== 'wallet') return
    const value = parseAmount(amount)
    if (!value) return setError('Enter an amount.')
    if (balances.ownerWif != null && value > balances.ownerWif) return setError('Your wallet doesn’t have that much $WIF.')
    setError('')
    setBusy('Confirm in your wallet…')
    try {
      const hash = await owner.client.sendTransaction({
        to: WIF_TOKEN,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address, value] }),
      })
      setBusy('Moving $WIF…')
      await publicClient.waitForTransactionReceipt({ hash })
      await balances.refresh()
      setAmount('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="step-body">
      <p className="lede">Send $WIF to your account to start. It never needs ETH.</p>
      <div className="field-static">
        <span className="mono break">{address}</span>
        <Copy value={address} label="account address" />
      </div>
      {owner.kind === 'wallet' && (balances.ownerWif ?? 0n) > 0n && (
        <form className="stack" onSubmit={move}>
          <div className="divider"><span>or move from your wallet</span></div>
          <div className="input-row">
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount of $WIF to move"
            />
            <button type="button" className="chip" onClick={() => setAmount(fmtWif(balances.ownerWif, 18).replace(/,/g, ''))}>
              Max {fmtWif(balances.ownerWif)}
            </button>
          </div>
          <Button type="submit" variant="ghost" busy={busy}>Move $WIF</Button>
          <p className="hint">This one transfer is a normal wallet transaction and uses a little ETH from your wallet.</p>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

export function EnableStep({ client, balances, paymaster, onDone }: StepProps) {
  const [busy, setBusy] = useState<string | false>(false)
  const [error, setError] = useState('')
  const fee = feeFor(paymaster, SETUP_GAS)

  const enable = async () => {
    setError('')
    setBusy('Sign to continue…')
    try {
      const result = await enableWifGas(client, () => setBusy('Confirming on Robinhood Chain…'))
      await balances.refresh()
      onDone({ ...result, label: 'Turned on $WIF gas' })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="step-body">
      <p className="lede">One-time setup. It creates your account on-chain and lets it pay gas in $WIF.</p>
      <div className="fee-line">
        <span>Gas</span>
        <span><b>≈ {fmtWif(fee, 4)} $WIF</b> · 0 ETH</span>
      </div>
      <Button onClick={enable} busy={busy} disabled={!paymaster.live}>Turn on $WIF gas</Button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

export function SendStep({ client, balances, paymaster, onDone }: StepProps) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<string | false>(false)
  const [error, setError] = useState('')
  const fee = feeFor(paymaster, SEND_GAS)
  const max = balances.wif != null && fee != null && balances.wif > fee * 2n ? balances.wif - fee * 2n : 0n

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = parseAmount(amount)
    if (!isAddress(to.trim())) return setError('Enter a valid 0x address.')
    if (!value) return setError('Enter an amount.')
    if (balances.wif != null && fee != null && value + fee > balances.wif) return setError('Leave enough $WIF to cover gas.')
    setError('')
    setBusy('Sign to continue…')
    try {
      const result = await sendWif(client, to.trim() as Address, value, () => setBusy('Confirming on Robinhood Chain…'))
      await balances.refresh()
      onDone({ ...result, label: `Sent ${fmtWif(value, 4)} $WIF` })
      setAmount('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="step-body" onSubmit={submit}>
      <label className="label" htmlFor="to">To</label>
      <input id="to" className="input mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} autoComplete="off" />
      <label className="label" htmlFor="amount">Amount</label>
      <div className="input-row">
        <input id="amount" className="input" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className="chip" onClick={() => setAmount(fmtWif(max, 18).replace(/,/g, ''))} disabled={max === 0n}>
          Max
        </button>
      </div>
      <div className="fee-line">
        <span>Gas</span>
        <span><b>≈ {fmtWif(fee, 4)} $WIF</b> · 0 ETH</span>
      </div>
      <Button type="submit" busy={busy} disabled={!paymaster.live}>Send $WIF</Button>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  )
}
