#!/usr/bin/env node
/**
 * Deterministic, coverage-verified sharding for the full repository test suite.
 *
 * The canonical suite is `pnpm test` = `tsx --test tests/*.test.ts`. This
 * runner keeps exactly that file set (no filtering, no skipping) and splits it
 * into N round-robin shards by sorted file index. Every shard:
 *   - writes its exact file manifest (shard-N.files.json),
 *   - streams the real TAP output (shard-N.tap.log),
 *   - records the real child exit code, signal, wall time and failed subtest
 *     names (shard-N.result.json),
 *   - propagates that real exit code as its own process exit code.
 *
 * A separate `verify` command is the aggregation gate: it re-computes the plan
 * from the checkout, checks that the union of shard manifests is exactly the
 * canonical file set with no duplicates, and fails if any shard failed. There
 * is no continue-on-error and no synthetic PASS anywhere in this path.
 *
 * `tests/*.test.mjs` and `tests/*.test.sh` are NOT part of `pnpm test`; they are
 * MySQL-integration / release-script checks invoked by their own commands and
 * are deliberately left untouched so the main baseline remains comparable.
 *
 * Usage:
 *   node scripts/test-shard.mjs --cli run --count 4 --index 1 --out <dir>
 *   node scripts/test-shard.mjs --cli verify --results <dir> --count 4
 */

import { spawn } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

export const TEST_FILE_SUFFIX = '.test.ts'
export const DEFAULT_SHARD_COUNT = 4
export const DEFAULT_TEST_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_WALL_MS = 2_700_000

/** Canonical, locale-independent, sorted file list for `pnpm test`. */
export function listTestFiles(repoRoot) {
  const testsDir = join(repoRoot, 'tests')
  return readdirSync(testsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX))
    .map((entry) => `tests/${entry.name}`)
    .sort()
}

/** Round-robin split. Shard indexes are 1-based. */
export function planShards(files, shardCount) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) {
    throw new RangeError('shardCount must be a positive safe integer')
  }
  const shards = Array.from({ length: shardCount }, () => [])
  files.forEach((file, index) => {
    shards[index % shardCount].push(file)
  })
  return shards
}

/** Verify that the shards exactly partition the canonical file set. */
export function verifyCoverage(shards, allFiles) {
  const owner = new Map()
  const duplicated = []
  shards.forEach((shard, shardPosition) => {
    for (const file of shard) {
      if (owner.has(file)) {
        duplicated.push({ file, first: owner.get(file), again: shardPosition + 1 })
      } else {
        owner.set(file, shardPosition + 1)
      }
    }
  })
  const expected = new Set(allFiles)
  const missing = allFiles.filter((file) => !owner.has(file))
  const extra = [...owner.keys()].filter((file) => !expected.has(file))
  const emptyShards = shards
    .map((shard, index) => ({ index: index + 1, count: shard.length }))
    .filter(({ count }) => count === 0)
  return {
    ok: duplicated.length === 0 && missing.length === 0 && extra.length === 0 && emptyShards.length === 0,
    totalFiles: allFiles.length,
    coveredFiles: owner.size,
    shardCounts: shards.map((shard) => shard.length),
    duplicated,
    missing,
    extra,
    emptyShards,
  }
}

/** Extract real failed subtest names from node:test TAP output. */
export function parseTapFailures(tapText) {
  const failures = []
  for (const line of tapText.split(/\r?\n/)) {
    const match = /(?:^|\s)not ok \d+\s+-\s+(.+)$/.exec(line)
    if (match) failures.push(match[1].trim())
  }
  return failures
}

function parseArgs(argv) {
  const options = { command: argv[0] ?? '' }
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      options[key] = true
    } else {
      options[key] = value
      index += 1
    }
  }
  return options
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === true) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`Expected a positive integer, received: ${value}`)
  }
  return parsed
}

function signalProcessTree(child) {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
}

function runShard(options) {
  const shardCount = positiveInteger(options.count, DEFAULT_SHARD_COUNT)
  const shardIndex = positiveInteger(options.index, 1)
  const testTimeoutMs = positiveInteger(options['timeout-ms'], DEFAULT_TEST_TIMEOUT_MS)
  const maxWallMs = positiveInteger(options['max-wall-ms'], DEFAULT_MAX_WALL_MS)
  const outDir = resolve(String(options.out ?? 'test-shard-results'))
  const repoRoot = resolve(String(options.root ?? process.cwd()))

  const allFiles = listTestFiles(repoRoot)
  const shards = planShards(allFiles, shardCount)
  const files = shards[shardIndex - 1]
  if (!files) {
    throw new RangeError(`shard index ${shardIndex} is outside 1..${shardCount}`)
  }

  mkdirSync(outDir, { recursive: true })
  const manifestPath = join(outDir, `shard-${shardIndex}.files.json`)
  const resultPath = join(outDir, `shard-${shardIndex}.result.json`)
  const tapPath = join(outDir, `shard-${shardIndex}.tap.log`)
  writeFileSync(manifestPath, `${JSON.stringify({
    shardIndex,
    shardCount,
    totalTestFiles: allFiles.length,
    fileCount: files.length,
    files,
  }, null, 2)}\n`)

  console.log(`SHARD_INDEX=${shardIndex}`)
  console.log(`SHARD_COUNT=${shardCount}`)
  console.log(`TOTAL_TEST_FILES=${allFiles.length}`)
  console.log(`SHARD_FILE_COUNT=${files.length}`)
  console.log(`TEST_TIMEOUT_MS=${testTimeoutMs}`)
  console.log(`SHARD_MAX_WALL_MS=${maxWallMs}`)
  console.log(`SHARD_FILE_MANIFEST=${manifestPath}`)
  console.log(`SHARD_FILES=${files.join(',')}`)

  const startedAt = Date.now()
  let tapText = ''
  let timedOut = false
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--test', `--test-timeout=${testTimeoutMs}`, ...files],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        // Keep the transform hook out of NODE_OPTIONS injection chains.
        CI: process.env.CI ?? '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  )

  const collect = (chunk, target) => {
    const text = chunk.toString()
    tapText += text
    target.write(text)
  }
  child.stdout?.on('data', (chunk) => collect(chunk, process.stdout))
  child.stderr?.on('data', (chunk) => collect(chunk, process.stderr))

  const wallTimer = setTimeout(() => {
    timedOut = true
    console.error(`SHARD_WALL_TIMEOUT=YES after ${maxWallMs}ms; killing the shard process tree`)
    signalProcessTree(child)
  }, maxWallMs)

  return new Promise((resolveRun) => {
    let settled = false
    const finish = (result, code) => {
      if (settled) return false
      settled = true
      clearTimeout(wallTimer)
      writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
      writeFileSync(tapPath, tapText)
      resolveRun(code)
      return true
    }

    child.once('error', (error) => {
      finish({
        shardIndex, shardCount, fileCount: files.length, files,
        exitCode: null, signal: null, spawnError: String(error.message ?? error),
        timedOut, durationMs: Date.now() - startedAt, failNames: [],
      }, 1)
      console.log('SHARD_EXIT_CODE=SPAWN_ERROR')
    })
    child.once('close', (code, signal) => {
      const failNames = parseTapFailures(tapText)
      const result = {
        shardIndex, shardCount, fileCount: files.length, files,
        exitCode: timedOut ? 124 : (code ?? 1), signal: signal ?? null,
        spawnError: null, timedOut, durationMs: Date.now() - startedAt,
        tapBytes: Buffer.byteLength(tapText), failNames,
      }
      if (!finish(result, result.exitCode === 0 ? 0 : 1)) return
      console.log(`SHARD_EXIT_CODE=${result.exitCode}`)
      console.log(`SHARD_SIGNAL=${result.signal ?? 'NONE'}`)
      console.log(`SHARD_TIMED_OUT=${timedOut ? 'YES' : 'NO'}`)
      console.log(`SHARD_FAILURE_COUNT=${failNames.length}`)
      for (const name of [...new Set(failNames)].sort()) console.log(`SHARD_FAILURE=${name}`)
      console.log(`SHARD_RESULT_FILE=${resultPath}`)
    })
  })
}

function verifyShards(options) {
  const shardCount = positiveInteger(options.count, DEFAULT_SHARD_COUNT)
  const resultsDir = resolve(String(options.results ?? 'test-shard-results'))
  const repoRoot = resolve(String(options.root ?? process.cwd()))

  const allFiles = listTestFiles(repoRoot)
  const expectedShards = planShards(allFiles, shardCount)
  const manifests = []
  const results = []
  let readError = null

  for (let index = 1; index <= shardCount; index += 1) {
    try {
      manifests.push(JSON.parse(readFileSync(join(resultsDir, `shard-${index}.files.json`), 'utf8')))
      results.push(JSON.parse(readFileSync(join(resultsDir, `shard-${index}.result.json`), 'utf8')))
    } catch (error) {
      readError = `shard-${index}: ${error.message ?? error}`
      break
    }
  }

  if (readError) {
    console.log(`SHARD_COVERAGE=INCOMPLETE`)
    console.log(`SHARD_COVERAGE_REASON=MISSING_ARTIFACT ${readError}`)
    return 1
  }

  const planMatches = manifests.every((manifest, position) =>
    manifest.shardIndex === position + 1 &&
    manifest.shardCount === shardCount &&
    manifest.totalTestFiles === allFiles.length &&
    Array.isArray(manifest.files) &&
    manifest.files.length === expectedShards[position].length &&
    manifest.files.every((file, fileIndex) => file === expectedShards[position][fileIndex]))

  const coverage = verifyCoverage(manifests.map((manifest) => manifest.files), allFiles)
  const exitCodes = results.map((result) => result.exitCode)
  const signals = results.map((result) => result.signal)
  const timedOut = results.some((result) => result.timedOut)
  const allSucceeded = exitCodes.every((code) => code === 0) && !timedOut
  const failNames = [...new Set(results.flatMap((result) => result.failNames ?? []))].sort()

  console.log(`SHARD_PLAN_MATCH=${planMatches ? 'YES' : 'NO'}`)
  console.log(`SHARD_COVERAGE=${coverage.ok ? 'COMPLETE' : 'INCOMPLETE'}`)
  console.log(`SHARD_TOTAL_TEST_FILES=${coverage.totalFiles}`)
  console.log(`SHARD_COVERED_TEST_FILES=${coverage.coveredFiles}`)
  console.log(`SHARD_COUNTS=${JSON.stringify(coverage.shardCounts)}`)
  console.log(`SHARD_MISSING_COUNT=${coverage.missing.length}`)
  console.log(`SHARD_DUPLICATED_COUNT=${coverage.duplicated.length}`)
  console.log(`SHARD_EXTRA_COUNT=${coverage.extra.length}`)
  console.log(`SHARD_EMPTY_COUNT=${coverage.emptyShards.length}`)
  console.log(`SHARD_EXIT_CODES=${JSON.stringify(exitCodes)}`)
  console.log(`SHARD_SIGNALS=${JSON.stringify(signals)}`)
  console.log(`SHARD_TIMED_OUT=${timedOut ? 'YES' : 'NO'}`)
  console.log(`SHARD_ALL_SUCCEEDED=${allSucceeded ? 'YES' : 'NO'}`)
  console.log(`SHARD_FAILURES_TOTAL=${failNames.length}`)
  for (const name of failNames) console.log(`SHARD_FAILURE=${name}`)
  for (const item of coverage.missing) console.log(`SHARD_MISSING_FILE=${item}`)
  for (const item of coverage.duplicated) console.log(`SHARD_DUPLICATED_FILE=${item.file} in ${item.first} and ${item.again}`)

  const ok = planMatches && coverage.ok && allSucceeded
  console.log(`SHARD_VERIFY_RESULT=${ok ? 'PASS' : 'FAIL'}`)
  return ok ? 0 : 1
}

async function main() {
  const cliArgs = process.argv.slice(2)
  const marker = cliArgs.indexOf('--cli')
  const options = parseArgs(marker === -1 ? cliArgs : cliArgs.slice(marker + 1))
  if (options.command === 'run') return runShard(options)
  if (options.command === 'verify') return verifyShards(options)
  throw new Error(`Unknown command: ${options.command || '(none)'}`)
}

const invokedAsScript = (process.argv[1] ?? '').endsWith('test-shard.mjs')
if (process.argv.includes('--cli') || invokedAsScript) {
  // Deliberately avoid top-level await: this file is also consumed through the
  // tsx CJS transform by the repository's node:test suite.
  Promise.resolve()
    .then(() => main())
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.error(`SHARD_RUNNER_ERROR=${error.message ?? error}`)
      process.exitCode = 2
    })
}
