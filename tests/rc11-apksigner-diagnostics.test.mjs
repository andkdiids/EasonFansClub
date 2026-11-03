import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  assertApksignerOutputMatches,
  parseApksignerOutput,
  verifyApksignerResult,
} from '../scripts/verify-android-apk-signature.mjs'

const repoRoot = process.cwd()
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8')
const expectedSigner = '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B'
const runnerApksignerOutput = [
  'Verifies',
  'Verified using v1 scheme (JAR signing): false',
  'Verified using v2 scheme (APK Signature Scheme v2): true',
  'Verified using v3 scheme (APK Signature Scheme v3): false',
  'Verified using v3.1 scheme (APK Signature Scheme v3.1): false',
  'Verified using v3.2 scheme (APK Signature Scheme v3.2): false',
  'Verified using v4 scheme (APK Signature Scheme v4): false',
  'Verified for SourceStamp: false',
  'Number of signers: 1',
  'V2 Signer: certificate DN: CN=Chen, OU=Chen, O=ECFC, L=SHENZHEN, ST=广东, C=CN',
  'V2 Signer: certificate SHA-256 digest: 12954323f60a594d2ab69dcb93112e8eb0a63344b11c03dab5fcca51a3fcd52b',
  'V2 Signer: certificate SHA-1 digest: 7ee5f35ac78f51dcb8303e18f6cac36decc18e6c',
  'V2 Signer: certificate MD5 digest: 3917a68548ad0107eb4778f7310685c0',
  'V2 Signer: key algorithm: RSA',
  'V2 Signer: key size (bits): 4096',
  'V2 Signer: public key SHA-256 digest: 556645de80bf8c36cb650efaa539b51133955f706ecd021dd64e090e3aeb52d7',
  'V2 Signer: public key SHA-1 digest: 89ca6407857f553c0789acf34a79e691c9de498c',
  'V2 Signer: public key MD5 digest: 6d3885aa83aad038ac92ff8506c7dc21',
].join('\n')

test('RC11 apksigner diagnostics are read-only and validate the fixed public artifact', () => {
  const workflowText = read('.github/workflows/diagnose-rc11-apksigner.yml')
  assert.match(workflowText, /runs-on:\s*ubuntu-22\.04/)
  assert.match(workflowText, /permissions:\s*\n\s+contents:\s*read/)
  assert.doesNotMatch(workflowText, /^\s+environment:/m)
  assert.match(workflowText, /pull_request:/)
  assert.match(workflowText, /9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C/)
  assert.match(workflowText, /183802143/)
  assert.match(workflowText, /\$\{apksigner\}" verify --verbose --print-certs/)
  assert.match(workflowText, /node scripts\/verify-android-apk-signature\.mjs/)
  assert.doesNotMatch(workflowText, /id-token:\s*write|ACTIONS_ID_TOKEN|AssumeRoleWithWebIdentity|coscli|Version API|configure-android-version\.yml/)
  assert.doesNotMatch(workflowText, /\$\{\{\s*secrets\./)
})

test('apksigner 0.9 runner fixture parses the scheme-prefixed single signer digest', () => {
  assert.deepEqual(parseApksignerOutput(runnerApksignerOutput), {
    signerCount: 1,
    sha256: expectedSigner,
  })
  assert.deepEqual(verifyApksignerResult({ status: 0, stdout: runnerApksignerOutput, stderr: '' }, expectedSigner), {
    signerCount: 1,
    sha256: expectedSigner,
  })
})

test('apksigner result combines stdout and stderr and accepts strict digest encodings', () => {
  const colonDigest = expectedSigner.match(/.{2}/g).join(':').toLowerCase()
  const parsed = verifyApksignerResult({
    status: 0,
    stdout: 'Number of signers: 1\r\n',
    stderr: `  V2 Signer: certificate SHA-256 digest:  ${colonDigest}  \r\n`,
  }, expectedSigner)
  assert.deepEqual(parsed, { signerCount: 1, sha256: expectedSigner })

  const standard = `Number of signers: 1\nSigner #1 certificate SHA-256 digest: ${expectedSigner}`
  assert.deepEqual(parseApksignerOutput(standard), { signerCount: 1, sha256: expectedSigner })
})

test('apksigner verifier separates parse, signer count, mismatch, signature and execution failures', () => {
  assert.throws(() => parseApksignerOutput(''), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput('Number of signers: 1'), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(`Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ${'X'.repeat(64)}`), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(`Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ${expectedSigner.slice(1)}`), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(`Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ${'A'.repeat(64)}A`), /SIGNER_PARSE_FAILED/)
  assert.throws(() => parseApksignerOutput(`Number of signers: 2\nSigner #1 certificate SHA-256 digest: ${expectedSigner}\nSigner #2 certificate SHA-256 digest: ${'A'.repeat(64)}`), /SIGNER_COUNT_INVALID/)
  assert.throws(() => parseApksignerOutput(`Number of signers: 1\nSigner #2 certificate SHA-256 digest: ${expectedSigner}`), /SIGNER_COUNT_INVALID/)
  assert.throws(() => parseApksignerOutput(`Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ${expectedSigner}\nV3 Signer: certificate SHA-256 digest: ${'A'.repeat(64)}`), /SIGNER_COUNT_INVALID/)
  assert.throws(() => assertApksignerOutputMatches(`Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ${'A'.repeat(64)}`, expectedSigner), /SIGNER_MISMATCH/)
  assert.throws(() => verifyApksignerResult({ status: 1, stdout: '', stderr: '' }, expectedSigner), /APK_SIGNATURE_INVALID/)
  assert.throws(() => verifyApksignerResult({ status: null, stdout: '', stderr: '' }, expectedSigner), /APKSIGNER_EXECUTION_FAILED/)
  assert.throws(() => verifyApksignerResult({ status: null, stdout: '', stderr: '', error: new Error('spawn failed') }, expectedSigner), /APKSIGNER_EXECUTION_FAILED/)
})

