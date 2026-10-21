import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PASSWORD_SECURITY_QA_DATABASE,
  resolvePasswordSecurityMysqlQaTarget,
} from './password-security-mysql-qa-target.mjs'

export const PASSWORD_SECURITY_MYSQL_REAL_ACCEPTANCE = 'IMPLEMENTED_NOT_RUN'
export const PASSWORD_SECURITY_MYSQL_NOT_COVERED = Object.freeze([
  'HTTP-level route and authentication middleware integration; the current production routes are not exposed as injectable services',
  'execution against the isolated MySQL instance; this is intentionally not performed by local unit/static checks',
])

const MYSQL_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u
const SUPPORTED_MYSQL_MAJOR_VERSION = 8

function fail(code) {
  const error = new Error(code)
  error.code = code
  return error
}

export function assertPasswordSecurityMysqlIdentity(rows, expectedDatabase = PASSWORD_SECURITY_QA_DATABASE) {
  if (!Array.isArray(rows) || rows.length !== 1) throw fail('MYSQL_IDENTITY_UNCONFIRMED')

  const row = rows[0]
  if (!row || row.databaseName !== expectedDatabase) throw fail('MYSQL_IDENTITY_UNCONFIRMED')
  if (typeof row.serverVersion !== 'string' || /mariadb/i.test(row.serverVersion)) {
    throw fail('MYSQL_VERSION_UNSUPPORTED')
  }

  const version = MYSQL_VERSION_PATTERN.exec(row.serverVersion)
  if (!version || Number(version[1]) !== SUPPORTED_MYSQL_MAJOR_VERSION) {
    throw fail('MYSQL_VERSION_UNSUPPORTED')
  }
}

/**
 * Validate the static target and explicit execution gates before loading Prisma.
 * The default acceptance suite is dynamically imported only after the selected
 * database identity has been confirmed. Unit tests may inject a fake client;
 * the CLI never does so and always loads the checked-in real suite.
 */
export async function runPasswordSecurityMysqlIntegration({
  env = process.env,
  loadPrismaClient = () => import('@prisma/client'),
  loadAcceptanceSuite = () => import('./password-security-mysql.integration.mjs'),
  runAcceptanceSuite,
} = {}) {
  const target = resolvePasswordSecurityMysqlQaTarget(env)
  if (env.PASSWORD_SECURITY_MYSQL_RUN !== '1') throw fail('REAL_MYSQL_RUN_GATE_REQUIRED')
  if (runAcceptanceSuite !== undefined && typeof runAcceptanceSuite !== 'function') {
    throw fail('MYSQL_ACCEPTANCE_SUITE_INVALID')
  }

  let prismaModule
  try {
    prismaModule = await loadPrismaClient()
  } catch {
    throw fail('PRISMA_CLIENT_LOAD_FAILED')
  }
  if (typeof prismaModule?.PrismaClient !== 'function') throw fail('PRISMA_CLIENT_LOAD_FAILED')

  let client
  try {
    client = new prismaModule.PrismaClient({
      datasources: { db: { url: target.connectionUrl } },
      log: [],
      errorFormat: 'minimal',
    })
  } catch {
    throw fail('PRISMA_CLIENT_INIT_FAILED')
  }

  try {
    try {
      await client.$connect()
    } catch {
      throw fail('MYSQL_CONNECTION_FAILED')
    }

    let rows
    try {
      rows = await client.$queryRaw`SELECT DATABASE() AS databaseName, VERSION() AS serverVersion`
    } catch {
      throw fail('MYSQL_IDENTITY_UNCONFIRMED')
    }
    assertPasswordSecurityMysqlIdentity(rows, target.database)

    if (runAcceptanceSuite) return await runAcceptanceSuite(client)

    const previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = target.connectionUrl
    try {
      let acceptanceModule
      try {
        acceptanceModule = await loadAcceptanceSuite()
      } catch {
        throw fail('MYSQL_ACCEPTANCE_SUITE_LOAD_FAILED')
      }
      if (typeof acceptanceModule?.runPasswordSecurityMysqlAcceptance !== 'function') {
        throw fail('MYSQL_ACCEPTANCE_SUITE_INVALID')
      }
      return await acceptanceModule.runPasswordSecurityMysqlAcceptance(client)
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }
  } finally {
    try {
      await client.$disconnect()
    } catch {
      // Driver details may include connection metadata; never surface them.
    }
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isDirectExecution()) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-real-mysql') {
    console.error('REAL_MYSQL_ACCEPTANCE_REQUIRES_EXPLICIT_FLAG')
    process.exitCode = 2
  } else {
    try {
      const result = await runPasswordSecurityMysqlIntegration()
      const count = Array.isArray(result?.passedCases) ? result.passedCases.length : 0
      console.log(`REAL_MYSQL_ACCEPTANCE_COMPLETED cases=${count}`)
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_:-]+$/u.test(error.code)
        ? error.code
        : 'MYSQL_ACCEPTANCE_FAILED'
      console.error(code)
      process.exitCode = 1
    }
  }
}
