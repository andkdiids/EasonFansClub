import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('TLS probe sends no database credentials and fails closed on verification errors', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { handshakeOptions, summarizeHandshake } from './.github/release/rc14-tls-handshake.mjs';
    const probe = handshakeOptions('DATABASE_URL="mysql://qa:private-test-password@db.example:3306/ecfc"');
    assert.ok(!JSON.stringify(probe).includes('private-test-password'));
    assert.ok(probe.args.includes('-verify_return_error'));
    assert.ok(probe.args.includes('-verify_hostname'));
    assert.equal(summarizeHandshake({status: 1, stderr:'verify error:num=20:unable to get local issuer certificate'}, 'db.example').verifyCode, 20);
    assert.equal(summarizeHandshake({status: 0, stdout:'Verify return code: 0 (ok)'}, 'db.example').status, 'FAILED_CLOSED');
    assert.equal(summarizeHandshake({status: 1, stderr:'MySQL server does not support SSL'}, 'db.example').serverTlsSupport, 'NOT_SUPPORTED');
    assert.throws(() => handshakeOptions('DATABASE_URL="mysql://qa:x@db.example/ecfc?sslcert=/tmp/untrusted.pem"'));
  `], { cwd: process.cwd(), stdio: 'pipe' })
})
