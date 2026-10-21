import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PASSWORD_SECURITY_MYSQL_NOT_COVERED,
  PASSWORD_SECURITY_MYSQL_REAL_ACCEPTANCE,
  assertPasswordSecurityMysqlIdentity,
  runPasswordSecurityMysqlIntegration,
} from './password-security-mysql-integration-runner.mjs'
import { PASSWORD_SECURITY_QA_DATABASE, PASSWORD_SECURITY_QA_PORT } from './password-security-mysql-qa-target.mjs'

const env = {
  PASSWORD_SECURITY_MYSQL_QA: '1',
  PASSWORD_SECURITY_MYSQL_QA_PORT: String(PASSWORD_SECURITY_QA_PORT),
  PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic:qa-only@127.0.0.1:${PASSWORD_SECURITY_QA_PORT}/${PASSWORD_SECURITY_QA_DATABASE}`,
  PASSWORD_SECURITY_MYSQL_RUN: '1',
}

function source(file) {
  return readFileSync(new URL(file, import.meta.url), 'utf8')
}

test('runner rejects absent QA and explicit real-run gates before loading Prisma', async () => {
  let prismaLoadCount = 0
  const loadPrismaClient = async () => { prismaLoadCount += 1; throw new Error('must not load') }
  for (const invalidEnv of [
    { ...env, PASSWORD_SECURITY_MYSQL_QA: undefined },
    { ...env, PASSWORD_SECURITY_MYSQL_RUN: undefined },
    { ...env, DATABASE_URL: 'mysql://not-used.invalid/production' },
  ]) {
    await assert.rejects(runPasswordSecurityMysqlIntegration({
      env: invalidEnv,
      loadPrismaClient,
      runAcceptanceSuite: async () => undefined,
    }), (error) => ['QA_GATE_REQUIRED', 'REAL_MYSQL_RUN_GATE_REQUIRED', 'DATABASE_FALLBACK_FORBIDDEN'].includes(error.code))
  }
  assert.equal(prismaLoadCount, 0)
})

test('unit simulation uses the explicit target and loads the acceptance suite only after identity confirmation', async () => {
  const events = []
  class UnitOnlyPrismaClient {
    constructor(options) { events.push(['construct', options]) }
    async $connect() { events.push(['connect']) }
    async $queryRaw(strings) {
      events.push(['identity-query', strings.join('?')])
      return [{ databaseName: PASSWORD_SECURITY_QA_DATABASE, serverVersion: '8.0.46' }]
    }
    async $disconnect() { events.push(['disconnect']) }
  }

  const previousDatabaseUrl = process.env.DATABASE_URL
  try {
    const result = await runPasswordSecurityMysqlIntegration({
      env,
      loadPrismaClient: async () => ({ PrismaClient: UnitOnlyPrismaClient }),
      loadAcceptanceSuite: async () => {
        events.push(['load-suite'])
        return { runPasswordSecurityMysqlAcceptance: async () => { events.push(['suite']); return { passedCases: ['unit-simulation-only'] } } }
      },
    })
    assert.deepEqual(result, { passedCases: ['unit-simulation-only'] })
    assert.deepEqual(events.map(([name]) => name), ['construct', 'connect', 'identity-query', 'load-suite', 'suite', 'disconnect'])
    assert.deepEqual(events[0][1], {
      datasources: { db: { url: env.PASSWORD_SECURITY_MYSQL_URL } },
      log: [],
      errorFormat: 'minimal',
    })
    assert.match(events[2][1], /^SELECT DATABASE\(\) AS databaseName, VERSION\(\) AS serverVersion$/u)
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  }
})

test('runner fails closed on wrong database, unsupported server, and failed connection without exposing driver errors', async () => {
  for (const identity of [
    [{ databaseName: 'ecfc_topic_v2_acceptance_20261020', serverVersion: '8.0.46' }],
    [{ databaseName: PASSWORD_SECURITY_QA_DATABASE, serverVersion: '10.11.7-MariaDB' }],
  ]) {
    let suiteCalled = false
    class WrongIdentityPrismaClient {
      async $connect() {}
      async $queryRaw() { return identity }
      async $disconnect() {}
    }
    await assert.rejects(runPasswordSecurityMysqlIntegration({
      env,
      loadPrismaClient: async () => ({ PrismaClient: WrongIdentityPrismaClient }),
      runAcceptanceSuite: async () => { suiteCalled = true },
    }), (error) => ['MYSQL_IDENTITY_UNCONFIRMED', 'MYSQL_VERSION_UNSUPPORTED'].includes(error.code))
    assert.equal(suiteCalled, false)
  }

  class FailedConnectionPrismaClient {
    async $connect() { throw new Error('mysql://qa-user:secret@127.0.0.1/private') }
    async $queryRaw() { assert.fail('identity query must not run') }
    async $disconnect() {}
  }
  await assert.rejects(runPasswordSecurityMysqlIntegration({
    env,
    loadPrismaClient: async () => ({ PrismaClient: FailedConnectionPrismaClient }),
    runAcceptanceSuite: async () => undefined,
  }), (error) => {
    assert.equal(error.code, 'MYSQL_CONNECTION_FAILED')
    assert.doesNotMatch(error.message, /secret|private|qa-user|mysql:\/\//u)
    return true
  })
})

test('MySQL identity requires exactly one confirmed MySQL 8.x database row', () => {
  assert.doesNotThrow(() => assertPasswordSecurityMysqlIdentity([
    { databaseName: PASSWORD_SECURITY_QA_DATABASE, serverVersion: '8.4.11' },
  ]))
  assert.throws(() => assertPasswordSecurityMysqlIdentity([]), { code: 'MYSQL_IDENTITY_UNCONFIRMED' })
  assert.throws(() => assertPasswordSecurityMysqlIdentity([
    { databaseName: PASSWORD_SECURITY_QA_DATABASE, serverVersion: '5.7.44' },
  ]), { code: 'MYSQL_VERSION_UNSUPPORTED' })
})

test('real MySQL suite is a runner-only module with no direct client, connect, SQL, or cleanup entrypoint', () => {
  const suite = source('./password-security-mysql.integration.mjs')
  assert.match(suite, /export async function runPasswordSecurityMysqlAcceptance\(client\)/u)
  assert.doesNotMatch(suite, /@prisma\/client|new PrismaClient|\$connect\(|\$queryRaw|\$executeRaw|migrate deploy|TRUNCATE|DROP DATABASE|process\.argv/u)
  assert.match(suite, /consumeResetTokenAndChangePassword/u)
  assert.match(suite, /commitPasswordChange/u)
  assert.match(suite, /verifySecurityAnswers/u)
  assert.match(suite, /userId: \{ in: userIds \}/u)
  assert.match(suite, /databaseCleanup: 'NOT_PERFORMED'/u)
  assert.doesNotMatch(suite, /client\.(user|passwordResetToken|onlineSession|mobileAuthSession|accountSecurityLog|pointLog)\.(findMany|count)\(\s*\)/u)

  const runner = source('./password-security-mysql-integration-runner.mjs')
  const targetIndex = runner.indexOf('resolvePasswordSecurityMysqlQaTarget(env)')
  const runGateIndex = runner.indexOf("env.PASSWORD_SECURITY_MYSQL_RUN !== '1'")
  const prismaLoadIndex = runner.indexOf('await loadPrismaClient()')
  const connectIndex = runner.indexOf('await client.$connect()')
  const identityIndex = runner.indexOf('assertPasswordSecurityMysqlIdentity(rows, target.database)')
  const suiteLoadIndex = runner.indexOf('await loadAcceptanceSuite()')
  assert.ok(targetIndex >= 0 && targetIndex < runGateIndex)
  assert.ok(runGateIndex < prismaLoadIndex && prismaLoadIndex < connectIndex)
  assert.ok(connectIndex < identityIndex && identityIndex < suiteLoadIndex)
  assert.match(runner, /process\.env\.DATABASE_URL = target\.connectionUrl/u)
  assert.match(runner, /REAL_MYSQL_ACCEPTANCE_REQUIRES_EXPLICIT_FLAG/u)
})

test('real acceptance coverage and remaining HTTP-level limitation are explicit, not reported as run', () => {
  assert.equal(PASSWORD_SECURITY_MYSQL_REAL_ACCEPTANCE, 'IMPLEMENTED_NOT_RUN')
  assert.ok(PASSWORD_SECURITY_MYSQL_NOT_COVERED.some((item) => item.includes('HTTP-level')))
  assert.ok(PASSWORD_SECURITY_MYSQL_NOT_COVERED.some((item) => item.includes('execution against the isolated MySQL instance')))
})
