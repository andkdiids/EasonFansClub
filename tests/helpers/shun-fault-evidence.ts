import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import type { Page } from 'playwright'

export type FaultEvidence = {
  id: string
  business: string
  scenario: string
  method: string
  before: unknown
  after: unknown
  result: 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED' | 'N/A'
  logPath: string
  reason?: string
}

export async function recordFaultEvidence(path: string, evidence: FaultEvidence) {
  assert.ok(evidence.id && evidence.method && evidence.logPath)
  if (['BLOCKED', 'N/A', 'NOT_RUN'].includes(evidence.result)) assert.ok(evidence.reason)
  await appendFile(path, JSON.stringify(evidence) + '\n', 'utf8')
}

// The response-loss branch contacts the real server before aborting delivery.
export async function injectHttpFailure(
  page: Page,
  url: string,
  mode: 'before-send' | 'after-commit',
  verifyCommitted?: () => Promise<void>,
) {
  await page.route(url, async (route) => {
    if (mode === 'before-send') return route.abort('internetdisconnected')
    const response = await route.fetch()
    assert.ok(response.ok(), 'The real operation must succeed before losing its response')
    await verifyCommitted?.()
    await route.abort('connectionreset')
  }, { times: 1 })
}
