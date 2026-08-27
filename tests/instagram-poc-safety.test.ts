import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafePocDatabaseTarget, REQUIRED_TEST_DATABASE_NAME } from '../lib/instagram/poc-safety'

const baseUrl = `mysql://poc:secret@127.0.0.1:3307/${REQUIRED_TEST_DATABASE_NAME}`

test('PoC database guard requires explicit isolated local-test target', () => {
  const target = assertSafePocDatabaseTarget({
    ANYWHERE_DOOR_TEST_DATABASE_ENV: 'local-test',
    ANYWHERE_DOOR_TEST_DATABASE_URL: baseUrl,
    DATABASE_URL: 'mysql://app:secret@remote.example:3306/easonfansclub',
  })
  assert.equal(target.environment, 'local-test')
  assert.equal(target.host, '127.0.0.1')
  assert.equal(target.databaseName, REQUIRED_TEST_DATABASE_NAME)
})

test('PoC database guard rejects missing or non-isolated targets', () => {
  assert.throws(() => assertSafePocDatabaseTarget({
    DATABASE_URL: baseUrl,
  }), /ABORT_UNSAFE_DATABASE/)

  assert.throws(() => assertSafePocDatabaseTarget({
    ANYWHERE_DOOR_TEST_DATABASE_ENV: 'local-test',
    ANYWHERE_DOOR_TEST_DATABASE_URL: 'mysql://poc:secret@remote.example:3306/easonfansclub',
  }), /ABORT_UNSAFE_DATABASE/)

  assert.throws(() => assertSafePocDatabaseTarget({
    ANYWHERE_DOOR_TEST_DATABASE_ENV: 'local-test',
    ANYWHERE_DOOR_TEST_DATABASE_URL: baseUrl,
    MYSQL_TEST_URL: baseUrl,
  }), /ABORT_UNSAFE_DATABASE/)
})

test('PoC database guard accepts an explicitly named staging-test target', () => {
  const target = assertSafePocDatabaseTarget({
    ANYWHERE_DOOR_TEST_DATABASE_ENV: 'staging-test',
    ANYWHERE_DOOR_TEST_DATABASE_URL: `mysql://poc:secret@staging.example:3306/${REQUIRED_TEST_DATABASE_NAME}`,
    DATABASE_URL: 'mysql://app:secret@production.example:3306/easonfansclub',
  })
  assert.equal(target.environment, 'staging-test')
})
