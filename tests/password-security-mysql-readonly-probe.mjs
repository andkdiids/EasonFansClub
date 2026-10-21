import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PASSWORD_SECURITY_QA_DATABASE,
  resolvePasswordSecurityMysqlQaTarget,
} from './password-security-mysql-qa-target.mjs'

const SUPPORTED_MYSQL_VERSION = /^8\.0\.\d+(?:[-+].*)?$/u
const SAFE_SCHEMA_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
const HIGH_RISK_GRANTS = /\b(?:GRANT\s+OPTION|CREATE\s+USER|SUPER|SYSTEM_USER|FILE|PROCESS|RELOAD|SHUTDOWN|CREATE\s+TABLESPACE|REPLICATION\s+SLAVE|REPLICATION\s+CLIENT|BINLOG_ADMIN|CONNECTION_ADMIN|PERSIST_RO_VARIABLES_ADMIN)\b/iu

class ProbeFailure extends Error {
  constructor(code, details = {}) {
    super(code)
    this.code = code
    this.details = details
  }
}

function blocked(code, details = {}) {
  return Object.freeze({
    status: 'BLOCKED',
    code,
    probeReadOnly: true,
    targetDatabase: PASSWORD_SECURITY_QA_DATABASE,
    targetDatabaseExists: null,
    qaAccountScopeSafe: null,
    readyForInitializationReview: false,
    ...details,
  })
}

function ready(details) {
  return Object.freeze({
    status: 'PASS',
    code: 'READY_FOR_INITIALIZATION_REVIEW',
    probeReadOnly: true,
    targetDatabase: PASSWORD_SECURITY_QA_DATABASE,
    targetDatabaseExists: false,
    qaAccountScopeSafe: true,
    readyForInitializationReview: true,
    ...details,
  })
}

function metadataConnectionUrl(target) {
  const url = new URL(target.connectionUrl)
  // The shared target guard has already proved the original path is the exact
  // approved QA schema. Keep that identity check, but connect without selecting
  // the schema so a missing database can be distinguished from a server error.
  url.pathname = '/'
  if (url.search !== '' || url.hash !== '') throw new ProbeFailure('QA_GUARD_FAILED')
  return url.toString()
}

function assertServerIdentity(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new ProbeFailure('MYSQL_IDENTITY_FAILED')
  const row = rows[0]
  if (!row || typeof row.currentUser !== 'string' || row.currentUser.length === 0) {
    throw new ProbeFailure('MYSQL_IDENTITY_FAILED')
  }
  if (row.databaseName !== null && row.databaseName !== undefined && row.databaseName !== '') {
    throw new ProbeFailure('MYSQL_IDENTITY_FAILED')
  }
  if (typeof row.serverVersion !== 'string'
    || /mariadb/iu.test(row.serverVersion)
    || !SUPPORTED_MYSQL_VERSION.test(row.serverVersion)) {
    throw new ProbeFailure('MYSQL_VERSION_UNSUPPORTED')
  }
  return row.serverVersion
}

function assertSchemaLookup(rows, database) {
  if (!Array.isArray(rows)) throw new ProbeFailure('PROBE_FAILED')
  if (rows.length === 0) return false
  if (rows.length !== 1 || rows[0]?.schemaName !== database) {
    throw new ProbeFailure('MYSQL_IDENTITY_FAILED')
  }
  return true
}

function normalizeGrantResource(resource) {
  return resource.trim().replaceAll('`', '').replace(/\s+/gu, '')
}

function analyzeGrants(rows, database) {
  if (!Array.isArray(rows) || rows.length === 0) return { safe: false, canSeeTargetSchema: false }
  const allowedResource = `${database}.*`
  let targetSchemaPrivilegeSeen = false
  let safe = true

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      safe = false
      continue
    }
    const values = Object.values(row)
    if (values.length !== 1 || typeof values[0] !== 'string') {
      safe = false
      continue
    }
    const statement = values[0]
    if (HIGH_RISK_GRANTS.test(statement) || /\bIDENTIFIED\b/iu.test(statement)) safe = false

    const match = /^\s*GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/iu.exec(statement)
    if (!match) {
      safe = false
      continue
    }
    const privileges = match[1].trim().toUpperCase()
    const resource = normalizeGrantResource(match[2])

    // A global USAGE grant conveys no privileges. Any other global grant,
    // inherited role, or privilege on another schema is outside the allowlist.
    if (resource === '*.*') {
      if (privileges !== 'USAGE') safe = false
      continue
    }
    if (resource !== allowedResource) {
      safe = false
      continue
    }

    const privilegeNames = privileges.split(/\s*,\s*/u)
    if (privilegeNames.length === 0 || privilegeNames.some((name) => !SAFE_SCHEMA_PRIVILEGES.has(name))) {
      safe = false
    } else {
      targetSchemaPrivilegeSeen = true
    }
  }
  // MySQL may hide a schema from information_schema.schemata unless this
  // account has a privilege on it. Without that grant, an empty result cannot
  // reliably distinguish an absent database from an invisible existing one.
  return {
    safe: safe && targetSchemaPrivilegeSeen,
    canSeeTargetSchema: targetSchemaPrivilegeSeen,
  }
}

function connectionFailureCode(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (['P1000', 'P1010', 'ER_ACCESS_DENIED_ERROR', '1045'].includes(code)) return 'MYSQL_AUTH_FAILED'
  return 'MYSQL_CONNECTION_FAILED'
}

/**
 * Read only fixed server/database metadata for the statically guarded QA target.
 * No application suite is imported and no query text is accepted from callers.
 */
export async function runPasswordSecurityMysqlReadonlyProbe({
  env = process.env,
  loadPrismaClient = () => import('@prisma/client'),
} = {}) {
  let target
  try {
    target = resolvePasswordSecurityMysqlQaTarget(env)
  } catch {
    return blocked('QA_GUARD_FAILED')
  }

  let connectionUrl
  try {
    connectionUrl = metadataConnectionUrl(target)
  } catch {
    return blocked('QA_GUARD_FAILED')
  }

  let prismaModule
  try {
    prismaModule = await loadPrismaClient()
  } catch {
    return blocked('PRISMA_CLIENT_LOAD_FAILED')
  }
  if (typeof prismaModule?.PrismaClient !== 'function') return blocked('PRISMA_CLIENT_LOAD_FAILED')

  let client
  try {
    client = new prismaModule.PrismaClient({
      datasources: { db: { url: connectionUrl } },
      log: [],
      errorFormat: 'minimal',
    })
  } catch {
    return blocked('PRISMA_CLIENT_INIT_FAILED')
  }

  let outcome = blocked('PROBE_FAILED')
  try {
    try {
      await client.$connect()
    } catch (error) {
      throw new ProbeFailure(connectionFailureCode(error))
    }

    let identityRows
    try {
      identityRows = await client.$queryRaw`SELECT VERSION() AS serverVersion, CURRENT_USER() AS currentUser, DATABASE() AS databaseName`
    } catch {
      throw new ProbeFailure('MYSQL_IDENTITY_FAILED')
    }
    const serverVersion = assertServerIdentity(identityRows)

    let grantsRows
    try {
      grantsRows = await client.$queryRaw`SHOW GRANTS FOR CURRENT_USER()`
    } catch {
      throw new ProbeFailure('PROBE_FAILED')
    }
    const grantAssessment = analyzeGrants(grantsRows, target.database)
    if (!grantAssessment.canSeeTargetSchema) {
      throw new ProbeFailure('GRANTS_UNSAFE', {
        mysqlServerVersion: serverVersion,
        currentUserVerified: true,
        defaultSchemaSelected: false,
        targetDatabaseExists: null,
        qaAccountScopeSafe: false,
      })
    }

    let schemaRows
    try {
      schemaRows = await client.$queryRaw`SELECT SCHEMA_NAME AS schemaName FROM information_schema.schemata WHERE SCHEMA_NAME = ${target.database}`
    } catch {
      throw new ProbeFailure('PROBE_FAILED')
    }
    const targetDatabaseExists = assertSchemaLookup(schemaRows, target.database)
    const qaAccountScopeSafe = grantAssessment.safe
    const safeDetails = {
      mysqlServerVersion: serverVersion,
      currentUserVerified: true,
      defaultSchemaSelected: false,
      targetDatabaseExists,
      qaAccountScopeSafe,
    }

    if (!qaAccountScopeSafe) outcome = blocked('GRANTS_UNSAFE', safeDetails)
    else if (targetDatabaseExists) outcome = blocked('TARGET_DATABASE_EXISTS', safeDetails)
    else outcome = ready(safeDetails)
  } catch (error) {
    outcome = blocked(
      error instanceof ProbeFailure ? error.code : 'PROBE_FAILED',
      error instanceof ProbeFailure ? error.details : {},
    )
  } finally {
    try {
      await client.$disconnect()
    } catch {
      outcome = blocked('PROBE_FAILED')
    }
  }
  return outcome
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isDirectExecution()) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-readonly-probe') {
    console.error('READONLY_PROBE_REQUIRES_EXPLICIT_FLAG')
    process.exitCode = 2
  } else {
    const result = await runPasswordSecurityMysqlReadonlyProbe()
    console.log(JSON.stringify(result))
    if (result.status !== 'PASS') process.exitCode = 1
  }
}
