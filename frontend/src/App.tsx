import { useEffect, useState } from 'react'
import type { EIP1193Provider } from 'viem'
import { useAccount, useConfig, useConnect, useDisconnect, type Connector } from 'wagmi'
import { BUNDLER_URL, ENTRY_POINT, PAYMASTER, PAYMASTER_POST_OP_GAS, PAYMASTER_VERIFICATION_GAS, REPO_URL, WIF_TOKEN } from './config'
import { AddressLink, Button, CodeBlock, Copy, Notice } from './components/ui'
import { AccountMenu } from './components/AccountMenu'
import { EnableStep, FundStep, SendStep } from './components/Steps'
import { WalletModal } from './components/WalletModal'
import { friendlyError } from './lib/errors'
import { fmtEth, fmtWif } from './lib/format'
import { useBalances, useHistory, useLimitReset, usePaymaster, useStats } from './lib/hooks'
import type { SmartClient, Sponsored } from './lib/smart'
import { browserKey, browserOwner, hasExtensionWallet, walletOwner, type Owner } from './lib/wallet'

const LAST_OWNER = 'wif-paymaster:owner'
const STEPS = ['Add $WIF', 'Turn on $WIF gas', 'Send'] as const

type Receipt = Pick<Sponsored, 'txHash' | 'wifCharged' | 'wifBurned'> & { success?: boolean; label: string }

// Only the browser account is remembered here; wagmi remembers and restores the wallet itself
function rememberBrowser(on: boolean) {
  try {
    if (on) localStorage.setItem(LAST_OWNER, 'browser')
    else localStorage.removeItem(LAST_OWNER)
  } catch {
    // storage blocked: the session just won't be restored on reload
  }
}

function lastWasBrowser() {
  try {
    return localStorage.getItem(LAST_OWNER) === 'browser' && !!browserKey()
  } catch {
    return false
  }
}

// The smart-account code is the heavy part of connecting: start loading it as soon as the page is up
const loadSmart = () => import('./lib/smart')

const SNIPPET = `import { http } from 'viem'
import { createSmartAccountClient } from 'permissionless'

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
// The paymaster sponsors that one setup call and charges it in $WIF.`

export default function App() {
  const [owner, setOwner] = useState<Owner | null>(null)
  const [client, setClient] = useState<SmartClient | null>(null)
  const [useBrowser, setUseBrowser] = useState(lastWasBrowser)
  const [pending, setPending] = useState<string | false>(false)
  const [error, setError] = useState('')
  const [receipts, setReceipts] = useState<Receipt[]>([])

  const wallet = useAccount()
  const { connectors, connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const config = useConfig()
  const [picking, setPicking] = useState(false)
  const [recentId, setRecentId] = useState<string | null>(null)

  // EIP-6963 wallets by name; the plain injected connector only when no wallet announced itself
  const announced = connectors.filter((c) => c.id !== 'injected')
  const wallets = announced.length ? announced : hasExtensionWallet() ? connectors.filter((c) => c.id === 'injected') : []

  useEffect(() => {
    const t = setTimeout(loadSmart, 0)
    return () => clearTimeout(t)
  }, [])

  // One place builds the smart account, from whichever owner is active. It reruns when the wallet
  // switches account or disconnects (in the page or in the wallet itself).
  const walletAddress = wallet.status === 'connected' ? wallet.address : undefined
  const walletConnector = wallet.status === 'connected' ? wallet.connector : undefined
  useEffect(() => {
    if (!useBrowser && !(walletAddress && walletConnector)) {
      setOwner(null)
      setClient(null)
      setPending(false)
      return
    }
    let stale = false
    setPending((p) => p || 'Loading your account…')
    ;(async () => {
      const next = useBrowser
        ? browserOwner()
        : walletOwner(walletAddress!, (await walletConnector!.getProvider()) as EIP1193Provider)
      const { makeSmartClient } = await loadSmart()
      const smart = await makeSmartClient(next)
      if (stale) return
      setOwner(next)
      setClient(smart)
      setReceipts([])
      setError('')
    })()
      .catch((err) => !stale && setError(friendlyError(err)))
      .finally(() => !stale && setPending(false))
    return () => {
      stale = true
    }
  }, [useBrowser, walletAddress, walletConnector])

  // One button: connect straight away when the browser has a single wallet, otherwise let the user pick
  const openConnect = async () => {
    setError('')
    if (wallets.length === 1) return connectWith(wallets[0])
    try {
      setRecentId((await config.storage?.getItem('recentConnectorId')) ?? null)
    } catch {
      setRecentId(null)
    }
    setPicking(true)
  }

  const connectWith = async (connector: Connector) => {
    setPicking(false)
    setError('')
    setPending(`Open ${connector.name}…`)
    try {
      setUseBrowser(false)
      rememberBrowser(false)
      await connectAsync({ connector })
    } catch (err) {
      setError(friendlyError(err))
      setPending(false)
    }
  }

  const connectBrowser = async () => {
    setPicking(false)
    setError('')
    if (wallet.status === 'connected') await disconnectAsync().catch(() => {})
    rememberBrowser(true)
    setUseBrowser(true)
  }

  const disconnect = async () => {
    setUseBrowser(false)
    rememberBrowser(false)
    setReceipts([])
    if (wallet.status !== 'disconnected') await disconnectAsync().catch(() => {})
  }

  const connecting =
    pending ||
    (wallet.status === 'reconnecting' ? 'Reconnecting…' : wallet.status === 'connecting' ? 'Confirm in your wallet…' : false)

  const account = client?.account.address
  const balances = useBalances(account, owner?.kind === 'wallet' ? owner.address : undefined)
  const paymaster = usePaymaster()
  const stats = useStats(receipts.length)
  const resetAt = useLimitReset(account, paymaster.gasPrice, receipts.length)
  const history = useHistory(account, receipts.length)
  // This session's receipts first (they have labels), then older ops from the chain
  const activity: Receipt[] = [
    ...receipts,
    ...history
      .filter((h) => !receipts.some((r) => r.txHash === h.txHash))
      .map((h) => ({ ...h, label: 'Sponsored transaction' })),
  ]

  const enabled = (balances.allowance ?? 0n) > 0n
  const step = !client ? -1 : enabled ? 2 : (balances.wif ?? 0n) > 0n ? 1 : 0

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/logo.svg" alt="" width={22} height={22} /> wif paymaster
        </div>
        <div className="topbar-right">
          <span className={`pill ${paymaster.live ? 'pill-live' : paymaster.live === false ? 'pill-down' : ''}`}>
            <span className="dot" aria-hidden /> <span className="pill-text">Robinhood Chain</span>
          </span>
          {owner && client && (
            <AccountMenu
              owner={owner}
              account={client.account.address}
              wallet={walletConnector ? { name: walletConnector.name, icon: walletConnector.icon } : undefined}
              balances={balances}
              live={paymaster.live}
              onDisconnect={disconnect}
            />
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
              {connecting ? (
                <Button busy={connecting}>Connecting</Button>
              ) : (
                <>
                  <Button onClick={openConnect}>Connect wallet</Button>
                  <Button variant="ghost" onClick={connectBrowser}>
                    Create a browser account
                  </Button>
                </>
              )}
              <p className="hint">
                {wallets.length
                  ? 'Your wallet only signs. A gas-free smart account is created for it.'
                  : 'No wallet extension found. A browser account is a key kept on this device, best for small amounts.'}
              </p>
              {error && <Notice tone="error">{error}</Notice>}
              <WalletModal
                open={picking}
                wallets={wallets}
                recentId={recentId}
                onPick={connectWith}
                onBrowserAccount={connectBrowser}
                onClose={() => setPicking(false)}
              />
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
              {step >= 1 && resetAt && (
                <Notice>
                  This account reached today’s gas limit. It can send again at{' '}
                  {resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                </Notice>
              )}
              {step === 1 && <EnableStep client={client} owner={owner} balances={balances} paymaster={paymaster} blocked={!!resetAt} onDone={(r) => setReceipts((all) => [r, ...all])} />}
              {step === 2 && <SendStep client={client} owner={owner} balances={balances} paymaster={paymaster} blocked={!!resetAt} onDone={(r) => setReceipts((all) => [r, ...all])} />}

              {owner.kind === 'browser' && <BrowserKeyNote />}
            </>
          )}
        </section>

        {activity.length > 0 && (
          <section className="receipts" aria-label="Your transactions">
            {activity.map((r) => (
              <article key={r.txHash} className={`receipt ${r.success === false ? 'receipt-failed' : ''}`}>
                <div className="receipt-head">
                  <span className="receipt-title">{r.success === false ? `${r.label} (reverted)` : r.label}</span>
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
            <span className="stat-value">{stats ? Number(stats.ops).toLocaleString('en-US') : '—'}</span>
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
        {stats && stats.queuedBurn > 0n && (
          <p className="hint center">
            Burns settle in batches with <span className="mono">WIF.burn()</span>: {fmtWif(stats.queuedBurn)} $WIF is queued for the next one.
          </p>
        )}

        <details className="builders">
          <summary>Add $WIF gas to your app</summary>
          <p>Any ERC-4337 v0.7 smart account can use it. No API key and no signature: just point at the paymaster.</p>
          <CodeBlock lang="bash" code="npm i permissionless viem" label="install command" />
          <CodeBlock lang="TypeScript" code={SNIPPET} label="paymaster snippet" />
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
