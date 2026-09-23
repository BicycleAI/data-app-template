/**
 * Pins `diffSpecs`'s output for a fixed set of spec pairs. The human `text`
 * lines are the contract the Python port (`GET /versions/{a}/diff/{b}`) has
 * to match — regenerate with --update only when the diff wording or logic
 * changes on purpose.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { diffSpecs } from '../compose/diff.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const update = process.argv.includes('--update')
const goldenPath = `${root}/evals/diff.golden.json`
const golden = update ? {} : JSON.parse(readFileSync(goldenPath, 'utf8'))
let failed = false

const PAIRS = [
  ['retail-orders-health.json', 'retail-orders-health-filtered.json'],
  ['retail-orders-health.json', 'retail-refund-watch.json'],
  ['checkout-test-report.json', 'checkout-test-explorer.json'],
  ['checkout-test-explorer.json', 'checkout-test-scorecard.json'],
  ['retail-orders-health.json', 'retail-orders-health.json'],
]

const readSpec = (name) => JSON.parse(readFileSync(`${root}/spec/examples/${name}`, 'utf8'))

for (const [a, b] of PAIRS) {
  const key = `${a} -> ${b}`
  const actual = diffSpecs(readSpec(a), readSpec(b))
  if (update) golden[key] = actual
  else if (JSON.stringify(golden[key]) !== JSON.stringify(actual)) {
    process.stdout.write(`DRIFT   ${key}\n  expected ${JSON.stringify(golden[key])}\n  actual   ${JSON.stringify(actual)}\n`)
    failed = true
  } else process.stdout.write(`ok      ${key}\n`)
}
if (update) {
  writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`)
  process.stdout.write('golden updated\n')
}
process.exit(failed ? 1 : 0)
