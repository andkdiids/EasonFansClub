import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readTopicLotteryMigrationPhases } from '../scripts/topic-lottery-migration-plan'
import { isolatedMysqlInvocation } from '../scripts/mysql-isolated-utf8'

test('unreleased lottery migration is split without modifying its data model',()=>{
  const phases=readTopicLotteryMigrationPhases()
  assert.equal(phases.length,4)
  const all=phases.map(p=>p.sql).join('\n')
  assert.equal((phases[0].sql.match(/CREATE TABLE/g)||[]).length,7)
  assert.doesNotMatch(phases[0].sql,/ALTER TABLE `LotteryEntry`/)
  assert.equal((all.match(/ADD CONSTRAINT/g)||[]).length,15)
  for(const phase of phases){assert.match(phase.sql,/SET SESSION foreign_key_checks = 1/);assert.match(phase.sql,/SET SESSION lock_wait_timeout = 5/);assert.doesNotMatch(phase.sql,/foreign_key_checks\s*=\s*(?:0|OFF)|\b(?:DROP|RENAME|TRUNCATE)\s+(?:TABLE|COLUMN)/i)}
  assert.match(phases[1].sql,/NULL, ALGORITHM=INSTANT;/)
  assert.match(phases[2].sql,/ALGORITHM=INPLACE, LOCK=NONE;/)
  assert.match(phases[3].sql,/ON DELETE RESTRICT ON UPDATE CASCADE, ALGORITHM=COPY, LOCK=SHARED;/)
})

test('Birthday cake and Chinese default source bytes remain UTF8, not question marks',()=>{
  const sql=readFileSync('prisma/migrations/20260805200000_add_birthday_message/migration.sql','utf8')
  const schema=readFileSync('prisma/schema.prisma','utf8')
  assert.match(sql,/DEFAULT '🎂 生日纪念'/)
  assert.match(schema,/@default\("🎂 生日纪念"\)/)
  assert.equal(Buffer.from('🎂','utf8').toString('hex'),'f09f8e82')
})

test('isolated MySQL bootstrap transports SQL through explicit UTF8 stdin, not Windows argv',()=>{
  const client=process.platform==='win32'?'C:\\qa\\mysql.exe':'/qa/mysql'
  const invocation=isolatedMysqlInvocation(client,'ecfc_lottery_integration_encoding',"SELECT '🎂 生日纪念';")
  assert.ok(invocation.args.includes('--default-character-set=utf8mb4'))
  assert.ok(invocation.args.includes('--no-defaults'))
  assert.ok(invocation.args.includes('--host=127.0.0.1'))
  assert.ok(invocation.args.includes('--port=33307'))
  assert.ok(!invocation.args.some(arg=>arg.includes('🎂')||arg.startsWith('--execute')))
  assert.equal(invocation.input.toString('utf8'),"SELECT '🎂 生日纪念';")
  assert.throws(()=>isolatedMysqlInvocation(client,'production', 'SELECT 1'))
})
