import { useState, type ReactNode } from 'react'
import { EXPLORER } from '../config'
import { short } from '../lib/format'

export function Copy({ value, label, className = 'copy' }: { value: string; label?: string; className?: string }) {
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
    <button type="button" className={done ? `${className} done` : className} onClick={copy} aria-label={`Copy ${label ?? value}`}>
      {done ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

const TOKEN = /(\/\/[^\n]*|#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(import|from|export|const|let|async|await|return|new|function|npm|i)\b|\b(\d[\d_]*n?|true|false|null)\b/g

// Tiny highlighter for the snippets on this page: comments, strings, keywords, numbers.
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(code.slice(last, at))
    const kind = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'n'
    out.push(<span key={at} className={`tok-${kind}`}>{m[0]}</span>)
    last = at + m[0].length
  }
  out.push(code.slice(last))
  return out
}

export function CodeBlock({ code, lang, label }: { code: string; lang: string; label?: string }) {
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{lang}</span>
        <Copy value={code} label={label ?? `${lang} snippet`} className="copy codeblock-copy" />
      </div>
      <pre className="code"><code>{highlight(code)}</code></pre>
    </div>
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
