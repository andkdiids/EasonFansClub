import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function signerError(code) {
  throw new Error(code)
}

export function parseApksignerOutput(output) {
  if (typeof output !== 'string' || !output.length) signerError('SIGNER_PARSE_FAILED')

  const lines = output.replace(/^\uFEFF/, '').split(/\r?\n/)
  const countLines = lines.filter((line) => /^\s*Number of signers\s*:/i.test(line))
  if (countLines.length !== 1) signerError('SIGNER_PARSE_FAILED')

  const countMatch = countLines[0].match(/^\s*Number of signers\s*:\s*(\d+)\s*$/i)
  if (!countMatch) signerError('SIGNER_PARSE_FAILED')
  const signerCount = Number(countMatch[1])
  if (!Number.isSafeInteger(signerCount) || signerCount < 1) signerError('SIGNER_PARSE_FAILED')

  const digestLines = lines.filter((line) => /certificate SHA-256 digest/i.test(line))
  if (signerCount !== 1) signerError('SIGNER_COUNT_INVALID')
  if (digestLines.length === 0) signerError('SIGNER_PARSE_FAILED')
  if (digestLines.length !== signerCount) signerError('SIGNER_COUNT_INVALID')

  const digestMatch = digestLines[0].match(/^\s*Signer\s+#(\d+)\s+certificate SHA-256 digest\s*:\s*(.*?)\s*$/i)
  if (!digestMatch) signerError('SIGNER_PARSE_FAILED')
  if (Number(digestMatch[1]) !== 1) signerError('SIGNER_COUNT_INVALID')

  const sha256 = digestMatch[2].replace(/[\s:]/g, '').toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(sha256)) signerError('SIGNER_PARSE_FAILED')
  return { signerCount, sha256 }
}

export function assertApksignerOutputMatches(output, expectedSha256) {
  if (typeof expectedSha256 !== 'string' || !/^[A-F0-9]{64}$/i.test(expectedSha256)) {
    signerError('EXPECTED_SIGNER_INVALID')
  }
  const parsed = parseApksignerOutput(output)
  if (parsed.sha256 !== expectedSha256.toUpperCase()) signerError('SIGNER_MISMATCH')
  return parsed
}

function main() {
  const [apksignerPath, apkPath, expectedSha256] = process.argv.slice(2)
  if (!apksignerPath || !apkPath || !expectedSha256) signerError('SIGNER_ARGUMENTS_INVALID')

  const result = spawnSync(apksignerPath, ['verify', '--verbose', '--print-certs', apkPath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
  })
  if (result.error) signerError('APKSIGNER_EXECUTION_FAILED')
  if (result.status !== 0) signerError('APK_SIGNATURE_INVALID')

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  const parsed = assertApksignerOutputMatches(output, expectedSha256)
  process.stdout.write(`APK_SIGNER_COUNT=${parsed.signerCount}\n`)
  process.stdout.write(`APK_SIGNER_SHA256=${parsed.sha256}\n`)
  process.stdout.write('APK_SIGNATURE_VALID=YES\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'APK_SIGNATURE_CHECK_FAILED'
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  }
}
