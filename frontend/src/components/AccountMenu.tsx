import { useEffect, useId, useRef, useState } from 'react'
import { EXPLORER, WIF_TOKEN, robinhood } from '../config'
import type { Balances } from '../lib/hooks'
import { fmtEth, fmtWif, short } from '../lib/format'
import type { Owner } from '../lib/wallet'
import { Copy } from './ui'

type Props = {
  owner: Owner
  account: `0x${string}`
  wallet?: { name: string; icon?: string }
  balances: Balances
  live: boolean | null
  onDisconnect: () => void
}

/** Header button that opens the account panel: addresses, assets, network and disconnect. */
export function AccountMenu({ owner, account, wallet, balances, live, onDisconnect }: Props) {
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<'idle' | 'done' | 'failed'>('idle')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const isWallet = owner.kind === 'wallet'
  const label = isWallet ? wallet?.name ?? 'Wallet' : 'Browser account'

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const addWif = async () => {
    if (owner.kind !== 'wallet') return
    try {
      const ok = await owner.client.watchAsset({ type: 'ERC20', options: { address: WIF_TOKEN, symbol: 'WIF', decimals: 18 } })
      setAdded(ok ? 'done' : 'idle')
    } catch {
      setAdded('failed')
    }
  }

  return (
    <div className="acct" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="pill pill-button acct-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {isWallet && wallet?.icon ? <img src={wallet.icon} alt="" width={14} height={14} /> : <span className="acct-dot" aria-hidden />}
        <span className="mono">{short(isWallet ? owner.address : account)}</span>
        <svg className={`acct-chevron ${open ? 'up' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="acct-panel" id={panelId} role="dialog" aria-label="Account">
          <div className="acct-head">
            {isWallet && wallet?.icon && <img src={wallet.icon} alt="" width={20} height={20} />}
            <span className="acct-name">{label}</span>
            <span className={`acct-net ${live ? 'ok' : live === false ? 'down' : ''}`}>
              <span className="dot" aria-hidden /> {robinhood.name}
            </span>
          </div>

          <AddressRow title="Gas-free account" hint="Holds your $WIF and pays gas" address={account} />
          {isWallet && <AddressRow title="Signer" hint={`${label} signs for the account`} address={owner.address} />}

          <div className="acct-section">
            <span className="acct-title">Assets</span>
            <ul className="acct-assets">
              <Asset symbol="$WIF" where="Gas-free account" value={fmtWif(balances.wif, 4)} accent />
              <Asset symbol="ETH" where="Gas-free account" value={fmtEth(balances.eth)} />
              {isWallet && <Asset symbol="$WIF" where={label} value={fmtWif(balances.ownerWif, 4)} accent />}
            </ul>
          </div>

          <div className="acct-actions">
            {isWallet && (
              <button type="button" className="acct-action" onClick={addWif} disabled={added === 'done'}>
                {added === 'done' ? '$WIF added ✓' : added === 'failed' ? 'Couldn’t add $WIF, try again' : `Add $WIF to ${label}`}
              </button>
            )}
            <a className="acct-action" href={`${EXPLORER}/address/${account}`} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
            <button
              type="button"
              className="acct-action acct-disconnect"
              onClick={() => {
                setOpen(false)
                onDisconnect()
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddressRow({ title, hint, address }: { title: string; hint: string; address: string }) {
  return (
    <div className="acct-section">
      <span className="acct-title">{title}</span>
      <div className="acct-addr">
        <a className="mono link" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
          {short(address, 10, 8)}
        </a>
        <Copy value={address} label={title.toLowerCase()} />
      </div>
      <span className="acct-hint">{hint}</span>
    </div>
  )
}

function Asset({ symbol, where, value, accent }: { symbol: string; where: string; value: string; accent?: boolean }) {
  return (
    <li className="acct-asset">
      <span className={`acct-token ${accent ? 'accent-token' : ''}`} aria-hidden>{symbol.replace('$', '').slice(0, 1)}</span>
      <span className="acct-asset-name">
        {symbol}
        <span className="acct-hint">{where}</span>
      </span>
      <span className="acct-asset-value mono">{value}</span>
    </li>
  )
}
