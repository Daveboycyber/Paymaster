import { formatUnits, type Address } from 'viem'

export function fmtWif(wei: bigint | null | undefined, digits = 2) {
  if (wei == null) return '—'
  const n = Number(formatUnits(wei, 18))
  if (n > 0 && n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function fmtEth(wei: bigint | null | undefined) {
  if (wei == null) return '—'
  return Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 5 })
}

export const short = (value: string, head = 6, tail = 4) => `${value.slice(0, head)}…${value.slice(-tail)}`

export const isAddress = (value: string): value is Address => /^0x[0-9a-fA-F]{40}$/.test(value)
