import { useEffect, useRef } from 'react'
import type { Connector } from 'wagmi'

type Props = {
  open: boolean
  wallets: readonly Connector[]
  recentId?: string | null
  onPick: (connector: Connector) => void
  onBrowserAccount: () => void
  onClose: () => void
}

/** Wallet picker. A native <dialog> gives focus trapping, Escape and the backdrop for free. */
export function WalletModal({ open, wallets, recentId, onPick, onBrowserAccount, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Last-used wallet first
  const sorted = [...wallets].sort((a, b) => Number(b.id === recentId) - Number(a.id === recentId))

  return (
    <dialog
      ref={ref}
      className="wmodal"
      aria-labelledby="wmodal-title"
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="wmodal-body">
        <div className="wmodal-head">
          <h2 id="wmodal-title">Connect a wallet</h2>
          <button type="button" className="wmodal-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {sorted.length ? (
          <ul className="wmodal-list">
            {sorted.map((c) => (
              <li key={c.uid}>
                <button type="button" className="wmodal-wallet" onClick={() => onPick(c)}>
                  {c.icon ? <img src={c.icon} alt="" width={28} height={28} /> : <span className="wmodal-icon" aria-hidden />}
                  <span className="wmodal-name">{c.id === 'injected' ? 'Browser wallet' : c.name}</span>
                  {c.id === recentId && <span className="wmodal-tag">Last used</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wmodal-empty">
            No wallet found in this browser. Install{' '}
            <a className="link" href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a>{' '}
            or another EVM wallet, then reload. Or use a browser account.
          </p>
        )}

        <div className="wmodal-foot">
          <button type="button" className="wmodal-alt" onClick={onBrowserAccount}>
            No wallet? Create a browser account
          </button>
          <p className="hint">Your wallet only signs. A gas-free smart account is created for it, so you never need ETH.</p>
        </div>
      </div>
    </dialog>
  )
}
