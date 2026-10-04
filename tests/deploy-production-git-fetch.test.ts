import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const deployScript = readFileSync('scripts/deploy-production-git.sh', 'utf8')
const fetchFunction = deployScript.match(/^fetch_exact_deploy_commit\(\) \{\r?\n[\s\S]*?^\}/m)?.[0]
const deploySha = 'a71e8ff40d9b7a80fa1450d7a87c054d361c7388'

assert.ok(fetchFunction, 'exact-SHA fetch function must be present in the deploy script')

const bashExecutable = (() => {
  if (process.platform !== 'win32') return 'bash'

  const candidates = [
    process.env.GIT_BASH_PATH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const executable = candidates.find((candidate) => existsSync(candidate))
  assert.ok(executable, 'Git Bash is required to run deploy shell tests on Windows')
  return executable
})()

type FetchOptions = {
  cacheHit?: boolean
  fetchResults?: number[]
  resolveSha?: boolean
}

function runFetch({ cacheHit = false, fetchResults = [0], resolveSha = true }: FetchOptions = {}) {
  const fetchResultsLiteral = fetchResults.join(',')
  const script = `
set -uo pipefail
DEPLOY_SHA='${deploySha}'
repo_dir='/server/repo'
CACHE_HIT='${cacheHit ? 'yes' : 'no'}'
FETCH_RESULTS='${fetchResultsLiteral}'
RESOLVE_SHA='${resolveSha ? 'yes' : 'no'}'
FETCH_COUNT=0

git() {
  printf 'GIT_CALL=%s\\n' "$*" >&2
  case "${'${3:-}'}" in
    cat-file)
      [ "${'${CACHE_HIT}'}" = yes ]
      ;;
    fetch)
      local result
      FETCH_COUNT=$((FETCH_COUNT + 1))
      local -a results
      IFS=',' read -r -a results <<< "${'${FETCH_RESULTS}'}"
      result="${'${results[$((FETCH_COUNT - 1))]:-1}'}"
      [ -n "${'${result}'}" ] || result=1
      return "${'${result}'}"
      ;;
    rev-parse)
      if [ "${'${RESOLVE_SHA}'}" = yes ]; then
        printf '%s\\n' "${'${DEPLOY_SHA}'}"
      else
        return 1
      fi
      ;;
    *) return 1 ;;
  esac
}

sleep() {
  printf 'SLEEP=%s\\n' "$1" >&2
}

${fetchFunction}
if ! fetch_exact_deploy_commit; then
  exit 1
fi
echo 'AFTER_FETCH_GATE=CONTINUED'
`

  const result = spawnSync(bashExecutable, ['-c', script], { encoding: 'utf8' })
  return {
    ...result,
    gitCalls: result.stderr?.split(/\r?\n/).filter((line) => line.startsWith('GIT_CALL=')).join('\n') ?? '',
    sleeps: result.stderr?.split(/\r?\n/).filter((line) => line.startsWith('SLEEP=')).map((line) => line.slice(6)).join('\n') ?? '',
  }
}

test('完整缓存命中时不执行网络 fetch', () => {
  const result = runFetch({ cacheHit: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /SERVER_GIT_CACHE_HIT=YES/)
  assert.doesNotMatch(result.gitCalls, / fetch /)
  assert.equal(result.sleeps, '')
})

test('第一次 exact SHA fetch 成功并验证解析结果', () => {
  const result = runFetch({ fetchResults: [0] })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /FETCH_ATTEMPT=1\/3/)
  assert.match(result.stdout, /SERVER_GIT_FETCH=OK/)
  assert.match(result.gitCalls, new RegExp(`fetch --no-tags --prune origin ${deploySha}`))
  assert.equal(result.sleeps, '')
})

test('第一次失败后等待 5 秒并在第二次成功', () => {
  const result = runFetch({ fetchResults: [1, 0] })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /FETCH_ATTEMPT=1\/3[\s\S]*FETCH_ATTEMPT=2\/3/)
  assert.match(result.stdout, /SERVER_GIT_FETCH=OK/)
  assert.equal(result.sleeps, '5')
})

test('前两次失败后分别等待 5 秒和 15 秒，第三次成功', () => {
  const result = runFetch({ fetchResults: [1, 1, 0] })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /FETCH_ATTEMPT=1\/3[\s\S]*FETCH_ATTEMPT=2\/3[\s\S]*FETCH_ATTEMPT=3\/3/)
  assert.match(result.stdout, /SERVER_GIT_FETCH=OK/)
  assert.equal(result.sleeps, '5\n15')
})

test('三次失败返回错误并停止后续部署阶段', () => {
  const result = runFetch({ fetchResults: [1, 1, 1] })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FETCH_ATTEMPT=3\/3/)
  assert.match(result.stderr, /SERVER_GIT_ACCESS=NOT_READY/)
  assert.doesNotMatch(result.stdout, /AFTER_FETCH_GATE=CONTINUED/)
  assert.equal(result.sleeps, '5\n15')
})

test('每次请求保留传入的 exact DEPLOY_SHA，不回退到分支或 HEAD', () => {
  const result = runFetch({ fetchResults: [1, 0] })
  assert.equal(result.status, 0, result.stderr)
  const fetchLines = result.gitCalls.split(/\r?\n/).filter((line) => / fetch /.test(line))
  assert.equal(fetchLines.length, 2)
  assert.ok(fetchLines.every((line) => line.endsWith(`origin ${deploySha}`)))
  assert.doesNotMatch(result.gitCalls, /pull|merge|checkout|FETCH_HEAD|origin\/main/)
})

test('exact-SHA fetch gate 位于 build、migration 和 current switch 之前', () => {
  const fetchGate = deployScript.indexOf('fetch_exact_deploy_commit || die')
  const worktreeStep = deployScript.indexOf('log_step "3/8" "Create an isolated release worktree"')
  const buildStep = deployScript.indexOf('pnpm_run build')
  const migrationStep = deployScript.indexOf('pnpm_run prisma migrate deploy')
  const switchStep = deployScript.indexOf('atomic_switch "${release_dir}"')

  assert.ok(fetchGate >= 0)
  assert.ok(fetchGate < worktreeStep)
  assert.ok(fetchGate < buildStep)
  assert.ok(fetchGate < migrationStep)
  assert.ok(fetchGate < switchStep)
})
