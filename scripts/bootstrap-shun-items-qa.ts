import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseline = 'ed804daa'
const migrations = [
  '20261127040000_add_shun_item_accounting',
  '20261127050000_add_shun_reward_event_receipts',
]
const [client, database, port = '33327'] = process.argv.slice(2)
if (!client || !/^ecfc_shun_[a-z0-9_]+_qa$/.test(database ?? '') || !/^33[3-9]\d{2}$/.test(port)) {
  throw new Error('Usage: tsx scripts/bootstrap-shun-items-qa.ts <mysql executable> <ecfc_shun_*_qa> [isolated port]')
}
const args = ['--no-defaults', '--protocol=TCP', '--host=127.0.0.1', '--port=' + port, '--user=root',
  '--default-character-set=utf8mb4', '--batch', '--skip-column-names']
const sql = (query: string, target?: string) => execFileSync(client, [...args, ...(target ? [target] : [])], {
  input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
})
const state = sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${database}';`)
if (state.trim() !== '0') throw new Error('Choose a new isolated schema name. This command never overwrites a database.')
const work = mkdtempSync(join(tmpdir(), 'ecfc-shun-bootstrap-'))
const datamodel = join(work, 'baseline.prisma')
writeFileSync(datamodel, execFileSync('git', ['show', `${baseline}:prisma/schema.prisma`]))
const requireLocal = createRequire(import.meta.url)
const ddl = execFileSync(process.execPath, [requireLocal.resolve('prisma/build/index.js'), 'migrate', 'diff',
  '--from-empty', '--to-schema-datamodel', datamodel, '--script'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const initialShun = readFileSync('prisma/migrations/20261123133000_add_shun_master/migration.sql', 'utf8')
const settings = initialShun.match(/INSERT INTO `ShunMasterSettings`[\s\S]*?;/)?.[0]
if (!settings) throw new Error('Missing original Shun settings seed')
sql(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
sql('SET SESSION foreign_key_checks = 0;\n' + ddl + '\nSET SESSION foreign_key_checks = 1;', database)
sql(settings, database)
for (const name of migrations) {
  sql(readFileSync(join('prisma', 'migrations', name, 'migration.sql'), 'utf8'), database)
  console.log(`Applied ${name}`)
}
console.log(`Bootstrapped ${database} from MySQL schema ${baseline} on loopback port ${port}`)
