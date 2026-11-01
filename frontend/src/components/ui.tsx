import { useState, type ReactNode } from 'react'
import { EXPLORER } from '../config'
import { short } from '../lib/format'

export function Copy({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    } catch {
      // clipboard blocked: the value is still selectable on screen
    }
  }
  return (
    <button type="button" className="copy" onClick={copy} aria-label={`Copy ${label ?? value}`}>
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

export function AddressLink({ address, kind = 'address' }: { address: string; kind?: 'address' | 'tx' | 'op' }) {
  return (
    <a className="mono link" href={`${EXPLORER}/${kind}/${address}`} target="_blank" rel="noreferrer">
      {short(address)}
    </a>
  )
}

export function Button({
  children, onClick, busy, disabled, variant = 'primary', type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  busy?: string | false
  disabled?: boolean
  variant?: 'primary' | 'ghost'
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled || !!busy}>
      {busy ? (
        <>
          <span className="spinner" aria-hidden /> {busy}
        </>
      ) : (
        children
      )}
    </button>
  )
}

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'error' | 'info'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}
