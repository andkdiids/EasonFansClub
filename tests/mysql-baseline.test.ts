import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { inspectMigrationSql } from '../scripts/check-migrations-mysql'

const projectRoot = path.resolve(__dirname, '..')
const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma')
const baselinePath = path.join(projectRoot, 'prisma', 'mysql-baseline', 'current', 'baseline.sql')
const metadataPath = path.join(projectRoot, 'prisma', 'mysql-baseline', 'current', 'metadata.json')

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

function canonicalizeText(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

test('MySQL baseline stays bound to its recorded snapshot while topic activity remains additive', () => {
  const schema = readFileSync(schemaPath, 'utf8')
  const baseline = readFileSync(baselinePath, 'utf8')
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
  const topicActivityMigration = readFileSync(path.join(projectRoot, 'prisma', 'migrations', '20261005120000_add_topic_activity_system', 'migration.sql'), 'utf8')
  const inspection = inspectMigrationSql('mysql-baseline/current', baseline)

  assert.equal(metadata.provider, 'mysql')
  assert.equal(metadata.baselineStatus, 'CANDIDATE')
  assert.equal(metadata.source, 'prisma/schema.prisma')
  assert.equal(metadata.productionVerified, false)
  assert.match(String(metadata.schemaHash), /^[a-f0-9]{64}$/)
  assert.equal(metadata.baselineHash, sha256(canonicalizeText(baseline)))
  assert.equal(inspection.findings.length, 0)
  if (metadata.schemaHash !== sha256(canonicalizeText(schema))) {
    assert.ok(Date.parse(String(metadata.generatedAt)) < Date.parse('2026-10-05T12:00:00+08:00'))
    assert.match(topicActivityMigration, /CREATE TABLE `TopicActivitySubmission`/)
    assert.match(topicActivityMigration, /CREATE TABLE `TopicActivityParticipation`/)
    assert.doesNotMatch(topicActivityMigration, /\bDROP\b|\bRENAME\b/i)
  }
})

test('MySQL baseline candidate contains the required social-post tables and constraints', () => {
  const baseline = readFileSync(baselinePath, 'utf8')
  for (const table of [
    'User',
    'Post',
    'Reply',
    'Notification',
    'SocialPost',
    'SocialPostMedia',
    'SocialPostLike',
    'SocialPostComment',
    'SocialSyncLog',
  ]) {
    assert.match(baseline, new RegExp('^CREATE TABLE `' + table + '` \\(', 'm'))
  }
  assert.match(baseline, /UNIQUE INDEX `SocialPost_platform_externalId_key`\(`platform`, `externalId`\)/)
  assert.match(baseline, /UNIQUE INDEX `SocialPostLike_userId_postId_key`\(`userId`, `postId`\)/)
  assert.match(baseline, /FOREIGN KEY \(`postId`\) REFERENCES `SocialPost`\(`id`\)/)
  assert.match(baseline, /FOREIGN KEY \(`parentId`\) REFERENCES `SocialPostComment`\(`id`\)/)
})
