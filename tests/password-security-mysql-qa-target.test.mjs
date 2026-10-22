import assert from 'node:assert/strict'
import test from 'node:test'
import { PASSWORD_SECURITY_QA_DATABASE, PASSWORD_SECURITY_QA_PORT, resolvePasswordSecurityMysqlQaTarget } from './password-security-mysql-qa-target.mjs'

const localTarget = {
  PASSWORD_SECURITY_MYSQL_QA: '1',
  PASSWORD_SECURITY_MYSQL_QA_PORT: String(PASSWORD_SECURITY_QA_PORT),
  PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic:qa-only@127.0.0.1:33307/${PASSWORD_SECURITY_QA_DATABASE}`,
}

test('requires the explicit QA gate and dedicated URL; never falls back to DATABASE_URL', () => {
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({ ...localTarget, PASSWORD_SECURITY_MYSQL_QA: undefined }), { code: 'QA_GATE_REQUIRED' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({ PASSWORD_SECURITY_MYSQL_QA: '1', DATABASE_URL: 'mysql://not-used.invalid/prod' }), { code: 'DATABASE_FALLBACK_FORBIDDEN' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({ ...localTarget, PASSWORD_SECURITY_MYSQL_URL: undefined }), { code: 'EXPLICIT_QA_URL_REQUIRED' })
})

test('accepts only mysql protocol, exact IPv4 loopback, fixed port 33307 and exact database name', () => {
  const target = resolvePasswordSecurityMysqlQaTarget(localTarget)
  assert.deepEqual({ host: target.host, port: target.port, database: target.database, protocol: target.protocol }, {
    host: '127.0.0.1', port: 33307, database: PASSWORD_SECURITY_QA_DATABASE, protocol: 'mysql:',
  })
  for (const host of ['localhost', '::1', '127.1', '192.0.2.10', 'production.example']) {
    assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
      ...localTarget,
      PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic:qa-only@${host}:33307/${PASSWORD_SECURITY_QA_DATABASE}`,
    }), { code: 'LOOPBACK_IPV4_REQUIRED' })
  }
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
    ...localTarget,
    PASSWORD_SECURITY_MYSQL_URL: `mysqls://qa_synthetic:qa-only@127.0.0.1:33307/${PASSWORD_SECURITY_QA_DATABASE}`,
  }), { code: 'MYSQL_PROTOCOL_REQUIRED' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
    ...localTarget,
    PASSWORD_SECURITY_MYSQL_URL: `MYSQL://qa_synthetic:qa-only@127.0.0.1:33307/${PASSWORD_SECURITY_QA_DATABASE}`,
  }), { code: 'MYSQL_PROTOCOL_REQUIRED' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
    ...localTarget,
    PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic:qa-only@127.0.0.1:3307/${PASSWORD_SECURITY_QA_DATABASE}`,
  }), { code: 'FIXED_QA_PORT_REQUIRED' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
    ...localTarget,
    PASSWORD_SECURITY_MYSQL_QA_PORT: '3307',
    PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic:qa-only@127.0.0.1:3307/${PASSWORD_SECURITY_QA_DATABASE}`,
  }), { code: 'FIXED_QA_PORT_REQUIRED' })
})

test('rejects query parameters, fragments, historical topic QA databases and unrelated database names', () => {
  for (const suffix of ['?sslaccept=strict', '?', '#fragment']) {
    assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
      ...localTarget,
      PASSWORD_SECURITY_MYSQL_URL: localTarget.PASSWORD_SECURITY_MYSQL_URL + suffix,
    }), { code: 'URL_QUERY_OR_FRAGMENT_FORBIDDEN' })
  }
  for (const databaseName of [
    'ecfc_topic_v2_acceptance_20261013',
    'ecfc_topic_v2_acceptance_20261014',
    'ecfc_topic_v2_acceptance_20261014b',
    'ecfc_topic_v2_acceptance_20261019',
    'ecfc_unrelated_test_db',
  ]) {
    assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
      ...localTarget,
      PASSWORD_SECURITY_MYSQL_URL: `mysql://qa_synthetic:qa-only@127.0.0.1:33307/${databaseName}`,
    }), { code: 'DATABASE_NAME_NOT_ALLOWLISTED' })
  }
})

test('fails closed on a missing fixed port declaration and on a missing QA username', () => {
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({ ...localTarget, PASSWORD_SECURITY_MYSQL_QA_PORT: undefined }), { code: 'FIXED_QA_PORT_REQUIRED' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({ ...localTarget, PASSWORD_SECURITY_MYSQL_QA_PORT: '0' }), { code: 'FIXED_QA_PORT_REQUIRED' })
  assert.throws(() => resolvePasswordSecurityMysqlQaTarget({
    ...localTarget,
    PASSWORD_SECURITY_MYSQL_URL: `mysql://127.0.0.1:33307/${PASSWORD_SECURITY_QA_DATABASE}`,
  }), { code: 'QA_USERNAME_REQUIRED' })
})

test('guard failures do not echo supplied URL or synthetic credential material', () => {
  const privateLooking = 'mysql://qa_synthetic:do-not-print@203.0.113.20:3306/prod'
  assert.throws(
    () => resolvePasswordSecurityMysqlQaTarget({ ...localTarget, PASSWORD_SECURITY_MYSQL_URL: privateLooking }),
    (error) => {
      assert.equal(error.code, 'LOOPBACK_IPV4_REQUIRED')
      assert.doesNotMatch(error.message, /qa_synthetic|do-not-print|203\.0\.113\.20|prod/u)
      return true
    },
  )
})
