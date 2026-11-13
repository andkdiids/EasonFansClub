import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('Prisma initialization error codes remain classified without exposing error contents', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import { prismaFailure } from './.github/release/strict-readonly-preflight.mjs';
  for (const [errorCode, reason] of [['P1011', 'TLS_FAILED'], ['P1000', 'AUTH_FAILED'], ['P1001', 'CONNECTION_FAILED'], ['P1002', 'TIMEOUT']]) {
    assert.equal(prismaFailure({ errorCode, message: 'sensitive details' }), 'PRISMA_' + reason);
    assert.equal(prismaFailure({ code: errorCode, message: 'sensitive details' }), 'PRISMA_' + reason);
  }
  assert.equal(prismaFailure({ message: 'sensitive details' }), 'PRISMA_QUERY_UNAVAILABLE');
  assert.equal(prismaFailure({ name: 'PrismaClientInitializationError', message: 'Error opening a TLS connection: sensitive details' }), 'PRISMA_TLS_FAILED');
  assert.equal(prismaFailure({ message: 'Error opening a TLS connection: certificate verify failed' }), 'PRISMA_TLS_CERTIFICATE_UNTRUSTED');
  assert.equal(prismaFailure({ message: 'Error opening a TLS connection: IP address mismatch' }), 'PRISMA_TLS_HOSTNAME_MISMATCH');
  `], { cwd: process.cwd(), stdio: 'pipe' })
})
