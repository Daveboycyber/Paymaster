import { useEffect, useState } from 'react'
import { BUNDLER_URL, ENTRY_POINT, PAYMASTER, PAYMASTER_POST_OP_GAS, PAYMASTER_VERIFICATION_GAS, REPO_URL, WIF_TOKEN } from './config'
import { AddressLink, Button, Copy, Notice } from './components/ui'
import { EnableStep, FundStep, SendStep } from './components/Steps'
import { fmtEth, fmtWif, short } from './lib/format'
import { useBalances, usePaymaster, useStats } from './lib/hooks'
import { friendlyError, makeSmartClient, type SmartClient, type Sponsored } from './lib/smart'
import { browserKey, browserOwner, connectWallet, hasExtensionWallet, type Owner } from './lib/wallet'

const LAST_OWNER = 'wif-paymaster:owner'
const STEPS = ['Add $WIF', 'Turn on $WIF gas', 'Send'] as const

type Receipt = Sponsored & { label: string }

function remember(kind: Owner['kind'] | null) {
  try {
    if (kind) localStorage.setItem(LAST_OWNER, kind)
    else localStorage.removeItem(LAST_OWNER)
  } catch {
    // storage blocked: the session just won't be restored on reload
  }
}

export default function App() {
  const [owner, setOwner] = useState<Owner | null>(null)
  const [client, setClient] = useState<SmartClient | null>(null)
  const [connecting, setConnecting] = useState<string | false>(false)
  const [error, setError] = useState('')
  const [receipts, setReceipts] = useState<Receipt[]>([])

  const account = client?.account.address
  const balances = useBalances(account, owner?.kind === 'wallet' ? owner.address : undefined)
  const paymaster = usePaymaster()
  const stats = useStats(receipts.length)

  const connect = async (getOwner: () => Owner | Promise<Owner>, label: string) => {
    setError('')
    setConnecting(label)
    try {
      const next = await getOwner()
      setClient(await makeSmartClient(next))
      setOwner(next)
      remember(next.kind)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setConnecting(false)
    }
  }

  // Restore the last session without prompting
  useEffect(() => {
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_OWNER)
    } catch {
      return
    }
    if (last === 'browser' && browserKey()) connect(browserOwner, 'Restoring…')
    if (last === 'wallet' && window.ethereum) {
      window.ethereum
        .request({ method: 'eth_accounts' })
        .then((accounts) => {
          if (accounts.length) connect(connectWallet, 'Restoring…')
        })
        .catch(() => {})
    }
  }, [])

  const disconnect = () => {
    setOwner(null)
    setClient(null)
    setReceipts([])
    remember(null)
  }

  const enabled = (balances.allowance ?? 0n) > 0n
  const step = !client ? -1 : enabled ? 2 : (balances.wif ?? 0n) > 0n ? 1 : 0

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◐</span> wif paymaster
        </div>
        <div className="topbar-right">
          <span className={`pill ${paymaster.live ? 'pill-live' : paymaster.live === false ? 'pill-down' : ''}`}>
            <span className="dot" aria-hidden /> <span className="pill-text">Robinhood Chain</span>
          </span>
          {owner && (
            <button type="button" className="pill pill-button" onClick={disconnect} title="Disconnect">
              {owner.kind === 'browser' ? 'Browser account' : short(owner.address)} ✕
            </button>
          )}
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <h1>Pay gas in <span className="accent">$WIF</span>.</h1>
          <p>
            Your account never needs ETH. Every fee is paid in $WIF, and{' '}
            {paymaster.burnBps != null ? `${Number(paymaster.burnBps) / 100}%` : 'part'} of it is burned.
          </p>
        </section>

        <section className="card" aria-label="Your account">
          {paymaster.live === false && paymaster.reason && <Notice>{paymaster.reason}</Notice>}

          {!client || !owner ? (
            <div className="connect">
              {hasExtensionWallet() ? (
                <>
                  <Button onClick={() => connect(connectWallet, 'Connecting…')} busy={connecting}>Connect wallet</Button>
                  <Button variant="ghost" onClick={() => connect(browserOwner, 'Creating…')} disabled={!!connecting}>
                    Create a browser account
                  </Button>
                </>
              ) : (
                <Button onClick={() => connect(browserOwner, 'Creating…')} busy={connecting}>Create a browser account</Button>
              )}
              <p className="hint">
                {hasExtensionWallet()
                  ? 'Your wallet only signs. A gas-free smart account is created for it.'
                  : 'No wallet extension found. A browser account is a key kept on this device, best for small amounts.'}
              </p>
              {error && <Notice tone="error">{error}</Notice>}
            </div>
          ) : (
            <>
              <div className="account">
                <div className="account-head">
                  <span className="label">Your gas-free account</span>
                  <span className="account-addr">
                    <AddressLink address={client.account.address} />
                    <Copy value={client.account.address} label="account address" />
                  </span>
                </div>
                <div className="balances">
                  <div className="balance">
                    <span className="balance-value">{fmtEth(balances.eth)}</span>
                    <span className="balance-unit">ETH</span>
                  </div>
                  <div className="balance balance-accent">
                    <span className="balance-value">{fmtWif(balances.wif)}</span>
                    <span className="balance-unit">$WIF</span>
                  </div>
                </div>
              </div>

              <ol className="steps" aria-label="Progress">
                {STEPS.map((name, i) => (
                  <li key={name} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
                    <span className="step-num">{i < step ? '✓' : i + 1}</span>
                    <span className="step-name">{name}</span>
                  </li>
                ))}
              </ol>

              {step === 0 && <FundStep client={client} owner={owner} balances={balances} />}
              {step === 1 && <EnableStep client={client} balances={balances} paymaster={paymaster} onDone={(r) => setReceipts((all) => [r, ...all])} />}
              {step === 2 && <SendStep client={client} balances={balances} paymaster={paymaster} onDone={(r) => setReceipts((all) => [r, ...all])} />}

              {owner.kind === 'browser' && <BrowserKeyNote />}
            </>
          )}
        </section>

        {receipts.length > 0 && (
          <section className="receipts" aria-label="Your transactions">
            {receipts.map((r) => (
              <article key={r.userOpHash} className={`receipt ${r.success ? '' : 'receipt-failed'}`}>
                <div className="receipt-head">
                  <span className="receipt-title">{r.success ? r.label : `${r.label} (reverted)`}</span>
                  <AddressLink address={r.txHash} kind="tx" />
                </div>
                <dl className="receipt-grid">
                  <div><dt>Gas paid</dt><dd>{fmtWif(r.wifCharged, 4)} $WIF</dd></div>
                  <div><dt>Burned</dt><dd>{fmtWif(r.wifBurned, 4)} $WIF</dd></div>
                  <div><dt>ETH used</dt><dd>0</dd></div>
                </dl>
              </article>
            ))}
          </section>
        )}

        <section className="stats" aria-label="Paymaster totals">
          <div className="stat">
            <span className="stat-value">{stats ? stats.ops.toLocaleString('en-US') : '—'}</span>
            <span className="stat-label">transactions sponsored</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats ? fmtWif(stats.charged, 0) : '—'}</span>
            <span className="stat-label">$WIF paid as gas</span>
          </div>
          <div className="stat">
            <span className="stat-value accent">{stats ? fmtWif(stats.burned, 0) : '—'}</span>
            <span className="stat-label">$WIF burned</span>
          </div>
        </section>

        <details className="builders">
          <summary>Add $WIF gas to your app</summary>
          <p>Any ERC-4337 v0.7 smart account can use it. No API key and no signature: just point at the paymaster.</p>
          <pre className="code"><code>{`import { createSmartAccountClient } from 'permissionless'

const client = createSmartAccountClient({
  account,                       // e.g. toSimpleSmartAccount(...)
  chain: robinhood,              // chain id 4663
  bundlerTransport: http('${BUNDLER_URL}'),
  paymaster: {
    getPaymasterData: async () => ({
      paymaster: '${PAYMASTER}',
      paymasterData: '0x',
      paymasterVerificationGasLimit: ${PAYMASTER_VERIFICATION_GAS}n,
      paymasterPostOpGasLimit: ${PAYMASTER_POST_OP_GAS}n,
    }),
  },
})

// New accounts: make the first call approve(paymaster, max) on $WIF.
// The paymaster sponsors that one setup call and charges it in $WIF.`}</code></pre>
        </details>
      </main>

      <footer className="footer">
        <div className="contracts">
          <span>Paymaster <AddressLink address={PAYMASTER} /></span>
          <span>$WIF <AddressLink address={WIF_TOKEN} /></span>
          <span>EntryPoint <AddressLink address={ENTRY_POINT} /></span>
        </div>
        <div className="footer-links">
          <a className="link" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <span>Built for the world is flat hackathon</span>
        </div>
      </footer>
    </div>
  )
}

function BrowserKeyNote() {
  const [shown, setShown] = useState(false)
  const key = browserKey()
  if (!key) return null
  return (
    <div className="keynote">
      <span>This account’s key lives only in this browser.</span>
      {shown ? (
        <span className="keynote-key">
          <span className="mono break">{key}</span>
          <Copy value={key} label="private key" />
        </span>
      ) : (
        <button type="button" className="textbtn" onClick={() => setShown(true)}>Back up key</button>
      )}
    </div>
  )
}
