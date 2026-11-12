import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('approved historical migration recovery matches the successful production ledger exactly', () => {
  const path = 'prisma/migrations/20260820140000_add_want_listen_session_exclusion/migration.sql'
  const bytes = readFileSync(path)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '9499df145c0984d16416b4210eb2061c5bd46273b5bc129fe9da94bff761d5b3')
  const prior = execFileSync('git', ['show', `61ba7a76d177cf46c309a166dd921b3e4a065f53:${path}`], { encoding: 'utf8' })
  assert.equal(bytes.toString('utf8'), prior.replace(/^--[^\n]*\n/, ''), 'only the explanatory comment may be removed; SQL remains byte-identical')
})
