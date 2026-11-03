import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const repoRoot = process.cwd()
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8')

test('RC11 apksigner diagnostics are read-only and validate the fixed public artifact', () => {
  const workflowText = read('.github/workflows/diagnose-rc11-apksigner.yml')
  const workflow = parse(workflowText) as {
    jobs?: Record<string, { 'runs-on'?: string; environment?: string }>
    permissions?: Record<string, string>
  }
  const diagnosticJob = workflow.jobs?.diagnose
  assert.equal(diagnosticJob?.['runs-on'], 'ubuntu-22.04')
  assert.equal(workflow.permissions?.contents, 'read')
  assert.equal(diagnosticJob?.environment, undefined)
  assert.match(workflowText, /pull_request:/)
  assert.match(workflowText, /9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C/)
  assert.match(workflowText, /183802143/)
  assert.match(workflowText, /\$\{apksigner\}" verify --verbose --print-certs/)
  assert.match(workflowText, /node scripts\/verify-android-apk-signature\.mjs/)
  assert.doesNotMatch(workflowText, /id-token:\s*write|ACTIONS_ID_TOKEN|AssumeRoleWithWebIdentity|coscli|Version API|configure-android-version\.yml/)
  assert.doesNotMatch(workflowText, /\$\{\{\s*secrets\./)
})
