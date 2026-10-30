import { useState } from 'react'
import { PAYMASTER, RATE_PROVIDER, WIF_TOKEN, ENTRY_POINT, EXPLORER } from './constants'

type Tab = 'dashboard' | 'enable' | 'actions' | 'activity' | 'builders'

const MOCK_STATS = {
  ethDeposited: '0.0007',
  wifCollected: '4,820',
  wifBurned: '1,446',
  sponsorships: 17,
  burnBps: 30,
}

const MOCK_ACTIVITY = [
  { hash: '0x3a2f…91c4', type: 'Vote', wif: '1.00', time: '2 min ago', status: 'Sponsored' },
  { hash: '0x8b1e…4d02', type: 'Transfer', wif: '0.42', time: '14 min ago', status: 'Sponsored' },
  { hash: '0xf90c…77a1', type: 'Vote', wif: '1.00', time: '31 min ago', status: 'Sponsored' },
  { hash: '0x21dd…c8e3', type: 'Approve', wif: '—', time: '1 hr ago', status: 'Confirmed' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [connected, setConnected] = useState(false)
  const [approved, setApproved] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)

  const connect = async () => {
    setStatus('loading')
    await new Promise(r => setTimeout(r, 800))
    setConnected(true)
    setStatus('idle')
  }

  const approve = async () => {
    setStatus('loading')
    await new Promise(r => setTimeout(r, 1200))
    setApproved(true)
    setStatus('success')
    setTimeout(() => setStatus('idle'), 2000)
  }

  const runAction = async () => {
    setStatus('loading')
    setTxHash(null)
    await new Promise(r => setTimeout(r, 1800))
    const hash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    setTxHash(hash)
    setStatus('success')
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'enable', label: 'Enable' },
    { id: 'actions', label: 'Actions' },
    { id: 'activity', label: 'Activity' },
    { id: 'builders', label: 'Builders' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green)' }} />
          <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: 14 }}>WIF PAYMASTER</span>
          <span className="badge badge-green" style={{ marginLeft: 8 }}>4663</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {connected ? (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>0x4dCA…7d10</span>
          ) : (
            <button className="btn" style={{ padding: '8px 16px', fontSize: 12 }} onClick={connect}>
              Connect
            </button>
          )}
        </div>
      </header>

      <nav style={{ borderBottom: '1px solid var(--border)', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: tab === t.id ? 'var(--green)' : 'var(--muted)',
              padding: '14px 16px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.5,
              borderBottom: tab === t.id ? '2px solid var(--green)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px 80px' }}>
        {tab === 'dashboard' && (
          <div>
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
                Pay gas in <span className="glow-text">$WIF</span>
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: 15, maxWidth: 520 }}>
                Zero ETH required. Every sponsored transaction creates demand for $WIF and burns a portion.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
              {[
                { label: 'ETH Deposited', value: MOCK_STATS.ethDeposited, unit: 'ETH' },
                { label: '$WIF Collected', value: MOCK_STATS.wifCollected, unit: 'WIF' },
                { label: '$WIF Burned', value: MOCK_STATS.wifBurned, unit: 'WIF' },
                { label: 'Sponsorships', value: MOCK_STATS.sponsorships, unit: '' },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {s.value} <span style={{ fontSize: 13, color: 'var(--muted)' }}>{s.unit}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: 'var(--green)' }}>THE FLYWHEEL</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 13 }}>
                <span style={{ padding: '8px 12px', background: '#000', border: '1px solid var(--border)', borderRadius: 3 }}>User pays gas in $WIF</span>
                <span style={{ color: 'var(--green)' }}>→</span>
                <span style={{ padding: '8px 12px', background: '#000', border: '1px solid var(--border)', borderRadius: 3 }}>Demand for $WIF</span>
                <span style={{ color: 'var(--green)' }}>→</span>
                <span style={{ padding: '8px 12px', background: '#000', border: '1px solid var(--border)', borderRadius: 3 }}>{MOCK_STATS.burnBps}% burned</span>
                <span style={{ color: 'var(--green)' }}>→</span>
                <span style={{ padding: '8px 12px', background: '#000', border: '1px solid var(--border)', borderRadius: 3 }}>More apps integrate</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setTab('enable')}>Enable Gas Payment</button>
              <button className="btn btn-ghost" onClick={() => setTab('actions')}>Try an Action</button>
            </div>
          </div>
        )}

        {tab === 'enable' && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Enable gas payment in $WIF</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 14 }}>One-time approval. After this, every transaction can be sponsored.</p>

            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>1. Connect smart account</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>EOA or ERC-4337 account</div>
                </div>
                {connected ? <span className="badge badge-green">Connected</span> : (
                  <button className="btn" style={{ padding: '8px 14px', fontSize: 12 }} onClick={connect}>Connect</button>
                )}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>2. Approve $WIF for Paymaster</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Allows the paymaster to pull gas fees</div>
                </div>
                {approved ? <span className="badge badge-green">Approved</span> : (
                  <button className="btn" style={{ padding: '8px 14px', fontSize: 12 }} onClick={approve} disabled={!connected || status === 'loading'}>
                    {status === 'loading' ? '…' : 'Approve'}
                  </button>
                )}
              </div>
            </div>

            {approved && (
              <div style={{ background: 'rgba(57,255,20,0.06)', border: '1px solid rgba(57,255,20,0.2)', borderRadius: 4, padding: 16, marginBottom: 20 }}>
                <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>Ready</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>You can now send transactions with zero ETH. Gas will be paid in $WIF.</div>
              </div>
            )}

            <button className="btn" onClick={() => setTab('actions')} disabled={!approved}>
              Continue to Actions →
            </button>
          </div>
        )}

        {tab === 'actions' && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Sponsored Actions</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 14 }}>These run as UserOperations. Gas is paid in $WIF.</p>

            <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
              {[
                { title: 'Vote with 1 $WIF', desc: 'Cast a vote on World is Fair — the original friction this paymaster fixes' },
                { title: 'Transfer $WIF', desc: 'Send tokens with zero ETH in the wallet' },
                { title: 'Custom Call', desc: 'Any contract interaction sponsored by the paymaster' },
              ].map(a => (
                <div key={a.title} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>{a.desc}</div>
                  </div>
                  <button
                    className="btn"
                    style={{ padding: '10px 16px', fontSize: 12, whiteSpace: 'nowrap' }}
                    onClick={runAction}
                    disabled={!connected || status === 'loading'}
                  >
                    {status === 'loading' ? '…' : 'Execute'}
                  </button>
                </div>
              ))}
            </div>

            {status === 'success' && txHash && (
              <div style={{ background: 'rgba(57,255,20,0.05)', border: '1px solid rgba(57,255,20,0.2)', borderRadius: 4, padding: 16 }}>
                <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 6 }}>Sponsored successfully</div>
                <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--green)' }}>
                  {txHash.slice(0, 14)}…{txHash.slice(-10)}
                </a>
              </div>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Recent Activity</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 14 }}>Sponsored transactions through this paymaster.</p>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 500 }}>Tx</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 500 }}>Type</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 500 }}>$WIF</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 500 }}>Time</th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted)', fontWeight: 500 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ACTIVITY.map((row, i) => (
                    <tr key={i} style={{ borderBottom: i < MOCK_ACTIVITY.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <td style={{ padding: '12px 16px' }} className="mono">{row.hash}</td>
                      <td style={{ padding: '12px 16px' }}>{row.type}</td>
                      <td style={{ padding: '12px 16px' }}>{row.wif}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{row.time}</td>
                      <td style={{ padding: '12px 16px' }}><span className="badge badge-green">{row.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'builders' && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>For Builders</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: 14 }}>
              Integrate the WIF Paymaster so your users never need ETH. Every integration increases $WIF demand and burns.
            </p>

            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--green)' }}>PAYMASTER ADDRESS</div>
              <code className="mono" style={{ color: 'var(--green)', fontSize: 13 }}>{PAYMASTER}</code>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--green)' }}>INTEGRATION SNIPPET</div>
              <pre style={{ background: '#000', padding: 16, borderRadius: 3, overflow: 'auto', fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>
{`// permissionless / Alchemy Account Kit
const userOp = await smartAccount.encodeUserOp({
  // your call
  paymaster: {
    address: "${PAYMASTER}",
  }
});

// User must approve first
await wif.approve("${PAYMASTER}", MaxUint256);`}
              </pre>
            </div>

            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--green)' }}>CONTRACTS</div>
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>Paymaster</span>
                  <a href={`${EXPLORER}/address/${PAYMASTER}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }} className="mono">{PAYMASTER.slice(0, 10)}…</a>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>Rate Provider</span>
                  <a href={`${EXPLORER}/address/${RATE_PROVIDER}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }} className="mono">{RATE_PROVIDER.slice(0, 10)}…</a>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>$WIF</span>
                  <a href={`${EXPLORER}/address/${WIF_TOKEN}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }} className="mono">{WIF_TOKEN.slice(0, 10)}…</a>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>EntryPoint</span>
                  <span className="mono">{ENTRY_POINT.slice(0, 10)}…</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
