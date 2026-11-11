import { encodeAbiParameters, encodeFunctionData, http, maxUint256, parseEventLogs, type Address, type Hex, type LocalAccount } from 'viem'
import { toAccount } from 'viem/accounts'
import { createSmartAccountClient } from 'permissionless'
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import {
  BUNDLER_URL, ENTRY_POINT, PAYMASTER, PAYMASTER_POST_OP_GAS, PAYMASTER_VERIFICATION_GAS, WIF_TOKEN, robinhood,
} from '../config'
import { erc20Abi, paymasterAbi } from './abi'
import { publicClient, read, write, type Owner } from './wallet'

const entryPoint = { address: ENTRY_POINT, version: '0.7' } as const

// Headroom over the quote for the signed maxWif cap, in case the keeper updates the rate before inclusion
const MAX_WIF_HEADROOM_BPS = 1_000n

const paymasterGas = {
  paymaster: PAYMASTER,
  paymasterVerificationGasLimit: PAYMASTER_VERIFICATION_GAS,
  paymasterPostOpGasLimit: PAYMASTER_POST_OP_GAS,
}

const encodeMaxWif = (maxWif: bigint) => encodeAbiParameters([{ type: 'uint256' }], [maxWif])

type GasFields = {
  callGasLimit?: bigint
  verificationGasLimit?: bigint
  preVerificationGas?: bigint
  maxFeePerGas?: bigint
}

/**
 * The paymaster needs no API or signature, only its address and gas limits. We also sign a maxWif cap:
 * the most this op may cost in $WIF, so nobody can raise the price after the user signs.
 */
async function paymasterData(op: GasFields) {
  const gas =
    (op.callGasLimit ?? 0n) + (op.verificationGasLimit ?? 0n) + (op.preVerificationGas ?? 0n) +
    PAYMASTER_VERIFICATION_GAS + PAYMASTER_POST_OP_GAS
  const maxCost = gas * (op.maxFeePerGas ?? 0n)
  const quote = await publicClient.readContract({ address: PAYMASTER, abi: paymasterAbi, functionName: 'quoteWif', args: [maxCost] })
  return { ...paymasterGas, paymasterData: encodeMaxWif((quote * (10_000n + MAX_WIF_HEADROOM_BPS)) / 10_000n) }
}

const bundler = createPimlicoClient({ transport: http(BUNDLER_URL), entryPoint })

async function feesPerGas() {
  try {
    return (await bundler.getUserOperationGasPrice()).fast
  } catch {
    // Not a Pimlico-compatible bundler: price off the chain with headroom
    const fees = await publicClient.estimateFeesPerGas()
    return { maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 2n }
  }
}

// The smart account address is fixed by its owner, so it is cached: reconnecting skips the RPC lookup
const addressKey = (owner: Address) => `wif-paymaster:account:${ENTRY_POINT}:${owner.toLowerCase()}`

// A wallet owner wrapped as a signer, so permissionless doesn't ask the wallet for its accounts again
function signer(owner: Owner): LocalAccount {
  if (owner.kind === 'browser') return owner.account
  const { client } = owner
  return toAccount({
    address: owner.address,
    signMessage: ({ message }) => client.signMessage({ message }),
    signTypedData: (typedData) => client.signTypedData(typedData as Parameters<typeof client.signTypedData>[0]),
    signTransaction: () => Promise.reject(new Error('The smart account signs messages only.')),
  })
}

export async function makeSmartClient(owner: Owner) {
  const cached = read(addressKey(owner.address)) as Address | null
  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer(owner),
    entryPoint,
    ...(cached ? { address: cached } : {}),
  })
  if (!cached) write(addressKey(owner.address), account.address)
  return createSmartAccountClient({
    account,
    chain: robinhood,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: {
      // Same length as the real data, so gas estimation matches
      getPaymasterStubData: async () => ({ ...paymasterGas, paymasterData: encodeMaxWif(maxUint256) }),
      getPaymasterData: (op) => paymasterData(op),
    },
    userOperation: { estimateFeesPerGas: feesPerGas },
  })
}

export type SmartClient = Awaited<ReturnType<typeof makeSmartClient>>

export type Sponsored = {
  userOpHash: Hex
  txHash: Hex
  success: boolean
  wifCharged: bigint
  wifBurned: bigint
}

async function send(client: SmartClient, call: { to: Address; data: Hex }, onSubmitted?: () => void): Promise<Sponsored> {
  const userOpHash = await client.sendUserOperation({ calls: [call] })
  onSubmitted?.()
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 })
  const [event] = parseEventLogs({ abi: paymasterAbi, logs: receipt.logs, eventName: 'UserOpSponsored' })
  return {
    userOpHash,
    txHash: receipt.receipt.transactionHash,
    success: receipt.success,
    wifCharged: event?.args.wifCharged ?? 0n,
    wifBurned: event?.args.wifBurned ?? 0n,
  }
}

/** One-time setup: deploys the account and approves the paymaster. Sponsored, paid in WIF. */
export function enableWifGas(client: SmartClient, onSubmitted?: () => void) {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PAYMASTER, maxUint256] })
  return send(client, { to: WIF_TOKEN, data }, onSubmitted)
}

export function sendWif(client: SmartClient, to: Address, amount: bigint, onSubmitted?: () => void) {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] })
  return send(client, { to: WIF_TOKEN, data }, onSubmitted)
}
