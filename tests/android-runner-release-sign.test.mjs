import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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
})

test('missing signing secrets fail before Gradle is called', () => {
  const env = { ...process.env }
  for (const name of ['ANDROID_RELEASE_KEYSTORE_BASE64', 'ANDROID_RELEASE_STORE_PASSWORD', 'ANDROID_RELEASE_KEY_ALIAS', 'ANDROID_RELEASE_KEY_PASSWORD']) delete env[name]
  const command = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-File', script.pathname, '-AndroidProjectRoot', 'missing', '-ApkSigner', 'missing', '-SignerVerifier', 'missing'], { env, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr + result.stdout, /SIGNING_SECRET_MISSING/)
  assert.doesNotMatch(result.stderr + result.stdout, /RELEASE_BUILD_AND_SIGNER=VERIFIED/)
})
