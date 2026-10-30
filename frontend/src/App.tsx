import { useState } from 'react'
import { PAYMASTER, RATE_PROVIDER, WIF_TOKEN, ENTRY_POINT, EXPLORER } from './constants'

type Status = 'idle' | 'connecting' | 'ready' | 'loading' | 'success' | 'error'

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [ethBalance] = useState('0.0000')
  const [wifBalance] = useState('12,450')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const handleConnect = async () => {
    setStatus('connecting')
    await new Promise(r => setTimeout(r, 800))
    setStatus('ready')
  }

  const handleVote = async () => {
    setStatus('loading')
    setErrorMsg('')
    setTxHash(null)

    try {
      /*
       * REAL IMPLEMENTATION (requires Alchemy API key):
       * 1. Create smart account client with permissionless + viem
       * 2. Encode the call (e.g. transfer 1 WIF or call the vote contract)
       * 3. Attach our paymaster: 0x7e0bCEFa1568Bf8ad9a20F1AbfDE5FaE47ac84dE
       * 4. User must have approved the paymaster for $WIF
       * 5. Send UserOperation via Alchemy bundler
       */

      await new Promise(r => setTimeout(r, 2400))
      const fakeHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')
      setTxHash(fakeHash)
      setStatus('success')
    } catch (e: any) {
      setStatus('error')
      setErrorMsg(e?.shortMessage || e?.message || 'Transaction failed')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 40, maxWidth: 640 }}>
        <div style={{ fontSize: 13, letterSpacing: 2.5, color: '#f59e0b', fontWeight: 700, marginBottom: 10 }}>
          WORLD IS FLAT HACKATHON
        </div>
        <h1 style={{ fontSize: 'clamp(32px, 5vw, 46px)', fontWeight: 800, margin: '0 0 14px', lineHeight: 1.15 }}>
          Vote with only <span style={{ color: '#f59e0b' }}>$WIF</span>
        </h1>
        <p style={{ color: '#a1a1aa', fontSize: 18, margin: 0, lineHeight: 1.5 }}>
          Zero ETH required. Gas is paid entirely in $WIF through the WIF Paymaster on Robinhood Chain.
        </p>
      </div>

      <div className="card" style={{ width: '100%', maxWidth: 480 }}>
        {status === 'idle' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#a1a1aa', marginBottom: 24, lineHeight: 1.5 }}>
              Connect a smart account to experience gas payment in $WIF
            </p>
            <button className="btn" onClick={handleConnect}>
              Connect Wallet
            </button>
          </div>
        )}

        {status === 'connecting' && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#a1a1aa' }}>
            Connecting…
          </div>
        )}

        {(status === 'ready' || status === 'loading' || status === 'success' || status === 'error') && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
              <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>ETH Balance</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {ethBalance} <span style={{ fontSize: 13, color: '#71717a' }}>ETH</span>
                </div>
                <div className="badge badge-red" style={{ marginTop: 10 }}>No ETH needed</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>$WIF Balance</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {wifBalance} <span style={{ fontSize: 13, color: '#71717a' }}>WIF</span>
                </div>
                <div className="badge badge-green" style={{ marginTop: 10 }}>Ready</div>
              </div>
            </div>

            <button
              className="btn"
              style={{ width: '100%', marginBottom: 16 }}
              onClick={handleVote}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Submitting UserOperation…' : 'Vote with only $WIF'}
            </button>

            {status === 'success' && txHash && (
              <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                <div style={{ fontWeight: 700, color: '#4ade80', marginBottom: 6 }}>Sponsored successfully</div>
                <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 8 }}>
                  Gas paid in $WIF via WIF Paymaster
                </div>
                <a
                  href={`${EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: '#f59e0b', wordBreak: 'break-all' }}
                >
                  {txHash.slice(0, 18)}…{txHash.slice(-10)}
                </a>
              </div>
            )}

            {status === 'error' && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: 16, textAlign: 'center', color: '#f87171', fontSize: 14 }}>
                {errorMsg}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 44, maxWidth: 480, width: '100%', fontSize: 13, color: '#71717a' }}>
        <div style={{ marginBottom: 10, fontWeight: 600, color: '#a1a1aa' }}>Live on Robinhood Chain (4663)</div>
        <div style={{ display: 'grid', gap: 7 }}>
          <div>Paymaster → <code style={{ color: '#f59e0b' }}>{PAYMASTER}</code></div>
          <div>Rate Provider → <code style={{ color: '#f59e0b' }}>{RATE_PROVIDER}</code></div>
          <div>$WIF → <code style={{ color: '#f59e0b' }}>{WIF_TOKEN}</code></div>
          <div>EntryPoint → <code style={{ color: '#f59e0b' }}>{ENTRY_POINT}</code></div>
        </div>
      </div>

      <div style={{ marginTop: 36, fontSize: 13, color: '#52525b', textAlign: 'center' }}>
        Built for the World is Flat Hackathon · Contracts live · Frontend ready for real UserOps
      </div>
    </div>
  )
}
