import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRate } from './keeper.mjs'

const e = (n) => BigInt(n) * 10n ** 18n
const base = { min: e(100_000), max: e(10_000_000), maxChangeBps: 2000n }

test('moves straight to the market when inside the limit', () => {
  assert.equal(nextRate({ ...base, current: e(2_000_000), market: e(1_800_000) }), e(1_800_000))
})

test('steps at most just under the per-update limit', () => {
  const next = nextRate({ ...base, current: e(1_000_000), market: e(3_000_000) })
  assert.ok(next < e(1_200_000) && next > e(1_199_000))
  const down = nextRate({ ...base, current: e(1_000_000), market: e(100_000) })
  assert.ok(down > e(800_000) && down < e(801_000))
})

test('stays inside the provider bounds', () => {
  assert.equal(nextRate({ ...base, current: e(9_900_000), market: e(20_000_000) }), e(10_000_000))
  assert.equal(nextRate({ ...base, current: e(110_000), market: e(1) }), e(100_000))
})
