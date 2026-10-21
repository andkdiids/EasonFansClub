import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PASSWORD_SECURITY_QA_DATABASE, PASSWORD_SECURITY_QA_PORT } from './password-security-mysql-qa-target.mjs'
import { runPasswordSecurityMysqlReadonlyProbe } from './password-security-mysql-readonly-probe.mjs'

const targetEnv = Object.freeze({
  PASSWORD_SECURITY_MYSQL_QA: '1',
  PASSWORD_SECURITY_MYSQL_QA_PORT: String(PASSWORD_SECURITY_QA_PORT),
  PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic@127.0.0.1:${PASSWORD_SECURITY_QA_PORT}/${PASSWORD_SECURITY_QA_DATABASE}`,
})

const safeGrants = [
  { grant: 'GRANT USAGE ON *.* TO `qa_synthetic`@`localhost`' },
  { grant: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${PASSWORD_SECURITY_QA_DATABASE}\`.* TO \`qa_synthetic\`@\`localhost\`` },
]

function fakeClient({
  version = '8.0.46',
  currentUser = 'qa_synthetic@localhost',
  defaultSchema = null,
  exists = false,
  grants = safeGrants,
  connectError,
  queryErrorAt,
  disconnectError,
} = {}) {
  const events = []
  const client = {
    async $connect() {
      events.push({ type: 'connect' })
      if (connectError) throw connectError
    },
    async $queryRaw(strings, ...values) {
      const query = strings.join('?')
      events.push({ type: 'query', query, values })
      if (queryErrorAt === events.filter((event) => event.type === 'query').length) {
        throw new Error(['mysql://', 'synthetic', ':', 'credential-must-not-leak', '@127.0.0.1:33307/private'].join(''))
      }
      if (query.includes('VERSION()')) return [{ serverVersion: version, currentUser, databaseName: defaultSchema }]
      if (query.includes('information_schema.schemata')) {
        return exists ? [{ schemaName: values[0] }] : []
      }
      if (query.includes('SHOW GRANTS')) return grants
      assert.fail(`Unexpected query shape in mock: ${query}`)
    },
    async $disconnect() {
      events.push({ type: 'disconnect' })
      if (disconnectError) throw disconnectError
    },
  }
  return { client, events }
}

async function runWithFake({ env = targetEnv, mock = fakeClient(), onConstruct } = {}) {
  let constructCount = 0
  const result = await runPasswordSecurityMysqlReadonlyProbe({
    env,
    loadPrismaClient: async () => ({
      PrismaClient: class FakePrismaClient {
        constructor(options) {
          constructCount += 1
          onConstruct?.(options)
          Object.assign(this, mock.client)
        }
      },
    }),
  })
  return { result, events: mock.events, constructCount }
}

function source() {
  return readFileSync(new URL('./password-security-mysql-readonly-probe.mjs', import.meta.url), 'utf8')
}

test('runs the fixed QA target guard before loading or constructing Prisma', async () => {
  let loadCount = 0
  for (const env of [
    { ...targetEnv, PASSWORD_SECURITY_MYSQL_QA: undefined },
    { ...targetEnv, PASSWORD_SECURITY_MYSQL_URL: targetEnv.PASSWORD_SECURITY_MYSQL_URL.replace('127.0.0.1', '192.0.2.10') },
    { ...targetEnv, PASSWORD_SECURITY_MYSQL_QA_PORT: '33308' },
    { ...targetEnv, PASSWORD_SECURITY_MYSQL_URL: targetEnv.PASSWORD_SECURITY_MYSQL_URL.replace(PASSWORD_SECURITY_QA_DATABASE, 'ecfc_topic_v2_acceptance_20261019') },
    { ...targetEnv, DATABASE_URL: 'mysql://not-used.invalid/production' },
  ]) {
    const result = await runPasswordSecurityMysqlReadonlyProbe({
      env,
      loadPrismaClient: async () => { loadCount += 1; throw new Error('must not load') },
    })
    assert.equal(result.code, 'QA_GUARD_FAILED')
    assert.equal(result.status, 'BLOCKED')
  }
  assert.equal(loadCount, 0)
})

test('connects without selecting the guarded target schema and performs exactly three fixed reads', async () => {
  let options
  const { result, events } = await runWithFake({ onConstruct: (value) => { options = value } })
  const metadataUrl = new URL(options.datasources.db.url)
  assert.equal(metadataUrl.protocol, 'mysql:')
  assert.equal(metadataUrl.hostname, '127.0.0.1')
  assert.equal(metadataUrl.port, String(PASSWORD_SECURITY_QA_PORT))
  assert.equal(metadataUrl.pathname, '/')
  assert.equal(metadataUrl.search, '')
  assert.equal(metadataUrl.hash, '')
  assert.equal(result.code, 'READY_FOR_INITIALIZATION_REVIEW')
  assert.equal(result.defaultSchemaSelected, false)
  assert.deepEqual(events.filter((event) => event.type === 'query').map((event) => event.query), [
    'SELECT VERSION() AS serverVersion, CURRENT_USER() AS currentUser, DATABASE() AS databaseName',
    'SHOW GRANTS FOR CURRENT_USER()',
    'SELECT SCHEMA_NAME AS schemaName FROM information_schema.schemata WHERE SCHEMA_NAME = ?',
  ])
  assert.deepEqual(events.filter((event) => event.type === 'query')[2].values, [PASSWORD_SECURITY_QA_DATABASE])
  assert.deepEqual(events.map((event) => event.type), ['connect', 'query', 'query', 'query', 'disconnect'])
})

test('accepts MySQL 8.0.x and rejects unsupported versions, MariaDB, and a selected default schema', async () => {
  for (const version of ['8.0.46', '8.0.36-commercial']) {
    const { result } = await runWithFake({ mock: fakeClient({ version }) })
    assert.equal(result.status, 'PASS')
    assert.equal(result.mysqlServerVersion, version)
  }
  for (const version of ['8.4.0', '5.7.44', '10.11.7-MariaDB', 'unknown']) {
    const { result } = await runWithFake({ mock: fakeClient({ version }) })
    assert.equal(result.code, 'MYSQL_VERSION_UNSUPPORTED')
  }
  const wrongDefault = await runWithFake({ mock: fakeClient({ defaultSchema: PASSWORD_SECURITY_QA_DATABASE }) })
  assert.equal(wrongDefault.result.code, 'MYSQL_IDENTITY_FAILED')
})

test('reports absent schema as not existing without creating it', async () => {
  const { result, events } = await runWithFake({ mock: fakeClient({ exists: false }) })
  assert.equal(result.targetDatabaseExists, false)
  assert.equal(result.readyForInitializationReview, true)
  assert.equal(events.filter((event) => event.type === 'query').length, 3)
  assert.equal(events.some((event) => /\b(?:CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/iu.test(event.query)), false)
})

test('reports an existing schema as blocked and never deletes, clears, or reuses it', async () => {
  const { result, events } = await runWithFake({ mock: fakeClient({ exists: true }) })
  assert.equal(result.code, 'TARGET_DATABASE_EXISTS')
  assert.equal(result.targetDatabaseExists, true)
  assert.equal(result.readyForInitializationReview, false)
  assert.equal(events.some((event) => /\b(?:CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/iu.test(event.query)), false)
})

test('accepts only USAGE globally and DML grants scoped to the exact QA schema', async () => {
  const accepted = await runWithFake({ mock: fakeClient({ grants: safeGrants }) })
  assert.equal(accepted.result.qaAccountScopeSafe, true)
  assert.equal(accepted.result.status, 'PASS')
})

test('fails closed on global privileges, other schemas, elevated grants, roles, and unknown grant syntax', async () => {
  const unsafeSets = [
    [{ grant: 'GRANT SELECT ON *.* TO `qa_synthetic`@`localhost`' }],
    [
      { grant: 'GRANT SELECT, INSERT ON *.* TO `qa_synthetic`@`localhost`' },
      { grant: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${PASSWORD_SECURITY_QA_DATABASE}\`.* TO \`qa_synthetic\`@\`localhost\`` },
    ],
    [{ grant: 'GRANT SELECT ON `another_database`.* TO `qa_synthetic`@`localhost`' }],
    [{ grant: `GRANT SELECT ON \`${PASSWORD_SECURITY_QA_DATABASE.toUpperCase()}\`.* TO \`qa_synthetic\`@\`localhost\`` }],
    [{ grant: `GRANT SELECT, CREATE USER ON \`${PASSWORD_SECURITY_QA_DATABASE}\`.* TO \`qa_synthetic\`@\`localhost\`` }],
    [{ grant: `GRANT SELECT ON \`${PASSWORD_SECURITY_QA_DATABASE}\`.* TO \`qa_synthetic\`@\`localhost\` WITH GRANT OPTION` }],
    [{ grant: "GRANT PROXY ON 'root'@'%' TO 'qa_synthetic'@'localhost'" }],
    [{ grant: 'unrecognized grant metadata' }],
  ]
  for (const grants of unsafeSets) {
    const { result } = await runWithFake({ mock: fakeClient({ grants }) })
    assert.equal(result.code, 'GRANTS_UNSAFE')
    assert.equal(result.qaAccountScopeSafe, false)
    assert.equal(result.readyForInitializationReview, false)
  }
})

test('does not claim safe account scope when SHOW GRANTS is empty or malformed', async () => {
  for (const grants of [[], [{ value: 1 }], [{ first: 'GRANT USAGE ON *.* TO x', second: 'unexpected' }]]) {
    const { result } = await runWithFake({ mock: fakeClient({ grants }) })
    assert.equal(result.code, 'GRANTS_UNSAFE')
  }
})

test('does not call an invisible schema absent when the account has only global USAGE', async () => {
  const { result, events } = await runWithFake({
    mock: fakeClient({ grants: [{ grant: 'GRANT USAGE ON *.* TO `qa_synthetic`@`localhost`' }] }),
  })
  assert.equal(result.code, 'GRANTS_UNSAFE')
  assert.equal(result.targetDatabaseExists, null)
  assert.equal(result.qaAccountScopeSafe, false)
  assert.equal(events.filter((event) => event.type === 'query').length, 2)
})

test('classifies known authentication failures without exposing driver messages', async () => {
  const error = Object.assign(new Error(['mysql://', 'synthetic', ':', 'do-not-leak', '@host/private'].join('')), { code: 'P1000' })
  const { result, events } = await runWithFake({ mock: fakeClient({ connectError: error }) })
  assert.equal(result.code, 'MYSQL_AUTH_FAILED')
  assert.doesNotMatch(JSON.stringify(result), /do-not-leak|synthetic:|mysql:\/\//u)
  assert.deepEqual(events.map((event) => event.type), ['connect', 'disconnect'])
})

test('redacts raw query errors and disconnects on every post-construction failure', async () => {
  const { result, events } = await runWithFake({ mock: fakeClient({ queryErrorAt: 2 }) })
  assert.equal(result.code, 'PROBE_FAILED')
  assert.doesNotMatch(JSON.stringify(result), /credential-must-not-leak|synthetic:|mysql:\/\//u)
  assert.equal(events.at(-1).type, 'disconnect')

  const versionFailure = await runWithFake({ mock: fakeClient({ version: '5.7.44' }) })
  assert.equal(versionFailure.events.at(-1).type, 'disconnect')
  const disconnectFailure = await runWithFake({ mock: fakeClient({ disconnectError: new Error('sensitive detail') }) })
  assert.equal(disconnectFailure.result.code, 'PROBE_FAILED')
  assert.doesNotMatch(JSON.stringify(disconnectFailure.result), /sensitive detail/u)
})

test('requires exactly one successful server identity row and an empty default schema', async () => {
  const malformed = fakeClient()
  malformed.client.$queryRaw = async () => []
  const { result } = await runWithFake({ mock: malformed })
  assert.equal(result.code, 'MYSQL_IDENTITY_FAILED')
})

test('probe is physically separate from the acceptance suite and exposes no arbitrary SQL input', () => {
  const text = source()
  assert.doesNotMatch(text, /password-security-mysql\.integration\.mjs|integration-runner\.mjs|runPasswordSecurityMysqlIntegration/u)
  assert.match(text, /resolvePasswordSecurityMysqlQaTarget\(env\)/u)
  assert.doesNotMatch(text, /\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe|migrate deploy|schema push|process\.env\.DATABASE_URL/u)
  assert.doesNotMatch(text, /\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe|\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:DATABASE|TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(?:DATABASE|TABLE)|TRUNCATE\s+TABLE|REVOKE\s+|CALL\s+|SET\s+(?:GLOBAL|PERSIST))\b/iu)
  assert.match(text, /process\.argv\.length !== 3 \|\| process\.argv\[2\] !== '--run-readonly-probe'/u)
  assert.doesNotMatch(text, /argv\[[^\]]+\].*(?:sql|query)/iu)
})

test('only fixed metadata query shapes are executed and target schema is a bound parameter', async () => {
  const { events } = await runWithFake()
  const queries = events.filter((event) => event.type === 'query')
  assert.equal(queries.length, 3)
  assert.ok(queries.every((event) => /^SELECT |^SHOW GRANTS FOR CURRENT_USER\(\)$/u.test(event.query)))
  assert.equal(queries[2].values[0], PASSWORD_SECURITY_QA_DATABASE)
  assert.equal(queries.some((event) => /information_schema\.(?!schemata)/u.test(event.query)), false)
})
