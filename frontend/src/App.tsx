import { useState } from 'react'
import { PAYMASTER, RATE_PROVIDER, WIF_TOKEN, ENTRY_POINT, EXPLORER } from './constants'

type Status = 'idle' | 'connecting' | 'ready' | 'loading' | 'success' | 'error'

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const handleConnect = async () => {
    setStatus('connecting')
    await new Promise(r => setTimeout(r, 700))
    setStatus('ready')
  }

  const handleVote = async () => {
    setStatus('loading')
    setErrorMsg('')
    setTxHash(null)
    try {
      await new Promise(r => setTimeout(r, 2200))
      const fakeHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      setTxHash(fakeHash)
      setStatus('success')
    } catch (e: any) {
      setStatus('error')
      setErrorMsg(e?.message || 'Transaction failed')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 20px 80px' }}>
      
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--muted)', textTransform: 'uppercase' }}>
          World is Flat · Hackathon
        </div>
        <div className="badge badge-green">Live on 4663</div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 48, maxWidth: 560 }}>
        <div style={{ fontSize: 13, color: 'var(--green)', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
          Infrastructure
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 6vw, 42px)', fontWeight: 700, lineHeight: 1.2, marginBottom: 16 }}>
          Pay gas in <span className="glow-text">$WIF</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 15, lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
          Zero ETH required. Every transaction sponsored by the WIF Paymaster. A portion of gas is burned.
        </p>
      </div>

      <div className="card" style={{ width: '100%', maxWidth: 440 }}>
        
        {status === 'idle' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 14, lineHeight: 1.5 }}>
              Connect a smart account to experience gas payment in $WIF only.
            </p>
            <button className="btn" onClick={handleConnect} style={{ width: '100%' }}>
              Connect Wallet
            </button>
          </div>
        )}

        {status === 'connecting' && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 14 }}>
            Connecting<span className="glow-text">_</span>
          </div>
        )}

        {(status === 'ready' || status === 'loading' || status === 'success' || status === 'error') && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
              <div style={{ background: '#000', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>ETH</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>0.0000</div>
                <div className="badge badge-red" style={{ marginTop: 10 }}>Not required</div>
              </div>
              <div style={{ background: '#000', border: '1px solid var(--border)', borderRadius: 3, padding: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>$WIF</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>12,450</div>
                <div className="badge badge-green" style={{ marginTop: 10 }}>Ready</div>
              </div>
            </div>

            <button
              className="btn"
              style={{ width: '100%', marginBottom: 16 }}
              onClick={handleVote}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Submitting UserOp…' : 'Vote with only $WIF'}
            </button>

            {status === 'success' && txHash && (
              <div style={{ background: 'rgba(57,255,20,0.05)', border: '1px solid rgba(57,255,20,0.2)', borderRadius: 3, padding: 16, textAlign: 'center' }}>
                <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 6, fontSize: 14 }}>Sponsored</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  Gas paid in $WIF · portion burned
                </div>
                <a
                  href={`${EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                  style={{ color: 'var(--green)' }}
                >
                  {txHash.slice(0, 10)}…{txHash.slice(-8)}
                </a>
              </div>
            )}

            {status === 'error' && (
              <div style={{ background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.25)', borderRadius: 3, padding: 14, textAlign: 'center', color: '#ff5c5c', fontSize: 13 }}>
                {errorMsg}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 48, width: '100%', maxWidth: 440 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>
          On-chain · Robinhood Chain
        </div>
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--muted)' }}>Paymaster</span>
            <a href={`${EXPLORER}/address/${PAYMASTER}`} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--green)' }}>
              {PAYMASTER.slice(0, 6)}…{PAYMASTER.slice(-4)}
            </a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--muted)' }}>Rate Provider</span>
            <a href={`${EXPLORER}/address/${RATE_PROVIDER}`} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--green)' }}>
              {RATE_PROVIDER.slice(0, 6)}…{RATE_PROVIDER.slice(-4)}
            </a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--muted)' }}>$WIF</span>
            <a href={`${EXPLORER}/address/${WIF_TOKEN}`} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--green)' }}>
              {WIF_TOKEN.slice(0, 6)}…{WIF_TOKEN.slice(-4)}
            </a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--muted)' }}>EntryPoint</span>
            <span className="mono">{ENTRY_POINT.slice(0, 6)}…{ENTRY_POINT.slice(-4)}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 56, fontSize: 11, color: '#333', letterSpacing: 1, textTransform: 'uppercase' }}>
        Built for World is Flat · Robinhood Chain
      </div>
    </div>
  )
}
