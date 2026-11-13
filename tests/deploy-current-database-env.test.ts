import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'dotenv'

test('Web and Worker reload override stale PM2 database URLs from the current shared env', () => {
  const script = readFileSync('scripts/deploy-production-git.sh', 'utf8')
  const source = script.match(/if ! node - "\$\{app_name\}"[^\n]*<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1]
  assert.ok(source)
  const current = 'mysql://qa:synthetic@db.example/ecfc?sslaccept=strict&sslcert=%2Fhome%2Fapps%2Feasonfansclub%2Fshared%2Fdatabase-ca.pem'
  for (const appName of ['easonfansclub', 'instagram-sync-worker']) {
    let written: { apps: Array<{ env: Record<string, string> }> } | undefined
    let fileMode: number | undefined
    const processStub = { argv: ['node', '-', appName, 'a'.repeat(40), '3000', '/synthetic-output', 'full', ''], exitCode: 0, stderr: { write: () => undefined } }
    runInNewContext(source, {
      URL, process: processStub,
      require(name: string) {
        if (name === 'node:path') return path
        if (name === 'dotenv') return { parse }
        if (name === 'node:fs') return {
          readFileSync: () => Buffer.from(`DATABASE_URL="${current}"\n`),
          writeFileSync: (_name: string, body: string, options: { mode: number }) => { written = JSON.parse(body); fileMode = options.mode },
        }
        if (name === path.resolve('ecosystem.config.js')) return { apps: [{ name: appName, env: { DATABASE_URL: 'mysql://stale/plaintext' } }] }
        throw Error('UNEXPECTED_REQUIRE')
      },
    })
    assert.equal(processStub.exitCode, 0)
    assert.equal(written?.apps[0].env.DATABASE_URL, current)
    assert.equal(fileMode, 0o600)
  }
})
