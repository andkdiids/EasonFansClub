import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Isolated QA only. No inherited URL/config, no native SQL argv, no production. */
export function isolatedMysqlInvocation(client: string, database: string, sql: string) {
  assert.ok(path.isAbsolute(client), 'explicit local MySQL executable required')
  assert.match(database, /^ecfc_(?:topic_v2_acceptance_202610(?:13|14b?)|lottery_integration_[a-z_]+)$/)
  return { client, args: ['--no-defaults','--protocol=TCP','--host=127.0.0.1','--port=33307',
    '--user=root','--default-character-set=utf8mb4','--batch','--raw','--skip-column-names',database],
    input: Buffer.from(sql,'utf8') }
}

export function runIsolatedMysqlUtf8(client: string, database: string, sql: string, timeout = 120_000) {
  const invocation=isolatedMysqlInvocation(client,database,sql)
  const result=spawnSync(invocation.client,invocation.args,{input:invocation.input,encoding:'utf8',timeout,maxBuffer:2*1024*1024,windowsHide:true,shell:false})
  if(result.error || result.status!==0) {
    const code=String(result.stderr || '').match(/^ERROR (\d+)/m)?.[1] || 'UNKNOWN'
    throw new Error(`ISOLATED_MYSQL_FAILED_${code}`)
  }
  return result.stdout.trim()
}
