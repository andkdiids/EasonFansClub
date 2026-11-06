import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_SHARD_COUNT,
  listTestFiles,
  parseTapFailures,
  planShards,
  verifyCoverage,
} from '../scripts/test-shard.mjs'

const repoRoot = resolve(process.cwd())

test('shard planning is deterministic and stable across repeated calls', () => {
  const files = ['tests/c.test.ts', 'tests/a.test.ts', 'tests/d.test.ts', 'tests/b.test.ts', 'tests/e.test.ts']
  const first = planShards(files, 4)
  const second = planShards(files, 4)

  assert.deepEqual(first, second)
  assert.deepEqual(first, [
    ['tests/c.test.ts', 'tests/e.test.ts'],
    ['tests/a.test.ts'],
    ['tests/d.test.ts'],
    ['tests/b.test.ts'],
  ])
})

test('shard planning rejects invalid shard counts', () => {
  assert.throws(() => planShards(['tests/a.test.ts'], 0), RangeError)
  assert.throws(() => planShards(['tests/a.test.ts'], -1), RangeError)
  assert.throws(() => planShards(['tests/a.test.ts'], 1.5), RangeError)
})

test('the canonical suite is exactly partitioned into four non-empty shards', () => {
  const allFiles = listTestFiles(repoRoot)
  assert.ok(allFiles.length > 500, `expected the full suite, got ${allFiles.length} files`)
  assert.equal(new Set(allFiles).size, allFiles.length, 'canonical list must not contain duplicates')
  assert.deepEqual([...allFiles].sort(), allFiles, 'canonical list must be sorted')
  assert.ok(allFiles.every((file) => file.startsWith('tests/') && file.endsWith('.test.ts')))

  const shards = planShards(allFiles, DEFAULT_SHARD_COUNT)
  assert.equal(shards.length, 4)
  const report = verifyCoverage(shards, allFiles)
  assert.equal(report.ok, true)
  assert.equal(report.totalFiles, allFiles.length)
  assert.equal(report.coveredFiles, allFiles.length)
  assert.equal(report.missing.length, 0)
  assert.equal(report.duplicated.length, 0)
  assert.equal(report.extra.length, 0)
  assert.equal(report.emptyShards.length, 0)
  assert.equal(report.shardCounts.reduce((sum, count) => sum + count, 0), allFiles.length)
  assert.ok(report.shardCounts.every((count) => count > 0))
  // Round-robin over a sorted list keeps every shard within one file of the mean.
  const spread = Math.max(...report.shardCounts) - Math.min(...report.shardCounts)
  assert.ok(spread <= 1, `unbalanced shards: ${JSON.stringify(report.shardCounts)}`)
})

test('coverage verification detects missing, duplicated, extra and empty shards', () => {
  const allFiles = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts']

  const missing = verifyCoverage([['tests/a.test.ts'], ['tests/b.test.ts'], []], allFiles)
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.missing, ['tests/c.test.ts'])
  assert.deepEqual(missing.emptyShards, [{ index: 3, count: 0 }])

  const duplicated = verifyCoverage(
    [['tests/a.test.ts'], ['tests/a.test.ts', 'tests/b.test.ts'], ['tests/c.test.ts']],
    allFiles,
  )
  assert.equal(duplicated.ok, false)
  assert.equal(duplicated.duplicated.length, 1)
  assert.equal(duplicated.duplicated[0].file, 'tests/a.test.ts')

  const extra = verifyCoverage(
    [['tests/a.test.ts'], ['tests/b.test.ts'], ['tests/c.test.ts', 'tests/z.test.ts']],
    allFiles,
  )
  assert.equal(extra.ok, false)
  assert.deepEqual(extra.extra, ['tests/z.test.ts'])
})

test('TAP failure parsing returns real failed subtest names only', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: first case',
    'ok 1 - first case',
    '# Subtest: broken case',
    'not ok 2 - broken case',
    '  ---',
    '  duration_ms: 1.2',
    '  ...',
    'ok 3 - skipped case # SKIP',
    'not ok 4 - another broken case',
    '1..4',
    '# fail 2',
  ].join('\n')

  assert.deepEqual(parseTapFailures(tap), ['broken case', 'another broken case'])
  assert.deepEqual(parseTapFailures('ok 1 - all good\n1..1\n# pass 1'), [])
})
