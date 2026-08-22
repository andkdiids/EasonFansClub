import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { formatMigrationCheck, inspectMigrationSql } from './check-migrations-mysql'
import { auditBaselineFile, formatBaselineAudit } from './audit-baseline'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'prisma/schema.prisma')
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, 'prisma/baseline-draft/0_init_baseline')
const OUTPUT_PATH = path.resolve(OUTPUT_DIR, 'migration.sql')

function main() {
  const force = process.argv.includes('--force')
  if (existsSync(OUTPUT_PATH) && !force) {
    throw new Error(`Baseline draft already exists: ${OUTPUT_PATH}; pass --force only to regenerate it`)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm', 'exec', 'prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', SCHEMA_PATH, '--script', '--output', OUTPUT_PATH]
    : [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      SCHEMA_PATH,
      '--script',
      '--output',
      OUTPUT_PATH,
    ]
  execFileSync(command, commandArgs, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  })

  const inspection = inspectMigrationSql('baseline-draft/0_init_baseline', readFileSync(OUTPUT_PATH, 'utf8'))
  console.log(`Baseline generated: YES (${OUTPUT_PATH})`)
  console.log(formatBaselineAudit(auditBaselineFile(OUTPUT_PATH)))
  console.log(formatMigrationCheck({
    cutoff: 0,
    legacy: [],
    future: [inspection],
    findings: inspection.findings,
    passed: !inspection.findings.some((finding) => finding.severity === 'ERROR'),
    highRisk: inspection.findings.some((finding) => finding.severity === 'HIGH'),
  }))
  if (inspection.findings.some((finding) => finding.severity === 'ERROR')) process.exitCode = 1
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
