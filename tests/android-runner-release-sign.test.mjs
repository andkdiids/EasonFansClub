import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = new URL('../scripts/android-runner-release-sign.ps1', import.meta.url)
const source = readFileSync(script, 'utf8')

test('runner signing removes inherited ACLs before writing and never prints native output', () => {
  const acl = source.indexOf('Set-Acl -LiteralPath $workDir')
  const write = source.indexOf('[IO.File]::Open($keyFile')
  assert.ok(acl > 0 && write > acl)
  for (const pattern of [/SetAccessRuleProtection\(\$true, \$false\)/, /FileMode\]::CreateNew/,
    /FileShare\]::None/, /RELEASE_OUTPUT_ALREADY_EXISTS/, /RELEASE_SIGNER_MISMATCH/,
    /foreach \(\$name in \(\$gradleNames \+ \$secretNames\)\)/,
    /Remove-Item -LiteralPath \$keyFile/, /Remove-Item -LiteralPath \$workDir/]) assert.match(source, pattern)
  assert.doesNotMatch(source, /Write-(?:Output|Host).*ANDROID_RELEASE_(?:KEYSTORE_BASE64|STORE_PASSWORD|KEY_PASSWORD)/)
  assert.match(source, /assembleRelease' \*> \$null/)
  for (const token of ['SHARED_SERVICE_IDENTITY_FORBIDDEN', 'SIGNING_LOCK_UNAVAILABLE', 'SIGNING_ORPHAN_REQUIRES_MANUAL_REVIEW', '$ownsKeyFile', '$ownsWorkDir']) assert.ok(source.includes(token))
})

test('missing signing secrets fail before Gradle is called', () => {
  const env = { ...process.env }
  for (const name of ['ANDROID_RELEASE_KEYSTORE_BASE64', 'ANDROID_RELEASE_STORE_PASSWORD', 'ANDROID_RELEASE_KEY_ALIAS', 'ANDROID_RELEASE_KEY_PASSWORD']) delete env[name]
  const command = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(script), '-AndroidProjectRoot', 'missing', '-ApkSigner', 'missing', '-SignerVerifier', 'missing'], { env, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr + result.stdout, /SIGNING_SECRET_MISSING/)
  assert.doesNotMatch(result.stderr + result.stdout, /RELEASE_BUILD_AND_SIGNER=VERIFIED/)
})

test('invalid synthetic keystore data does not invoke Gradle or leak into logs', () => {
  if (process.platform !== 'win32') return
  const temp = mkdtempSync(path.join(os.tmpdir(), 'ecfc-sign-test-'))
  const env = { ...process.env, RUNNER_TEMP: temp, ANDROID_RELEASE_KEYSTORE_BASE64: 'not!base64',
    ANDROID_RELEASE_STORE_PASSWORD: 'synthetic-store-only', ANDROID_RELEASE_KEY_ALIAS: 'synthetic-alias-only',
    ANDROID_RELEASE_KEY_PASSWORD: 'synthetic-key-only' }
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(script),
      '-AndroidProjectRoot', 'missing', '-ApkSigner', 'missing', '-SignerVerifier', 'missing'],
    { env, encoding: 'utf8', timeout: 30000 })
    assert.ifError(result.error)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr + result.stdout, /SIGNING_KEYSTORE_INVALID|SHARED_SERVICE_IDENTITY_FORBIDDEN/)
    for (const value of ['not!base64', 'synthetic-store-only', 'synthetic-alias-only', 'synthetic-key-only']) {
      assert.ok(!(result.stderr + result.stdout).includes(value))
    }
    assert.deepEqual(readdirSync(temp), [])
  } finally { rmdirSync(temp) }
})
