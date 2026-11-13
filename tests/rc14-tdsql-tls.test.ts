import { execFileSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('approved CA pins, signatures, strict connection identity and peer rejection remain enforced', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { validateCa, strictConfiguration, verifyPeer, CDB_PIN, ROOT_PIN } from './.github/release/rc14-tdsql-tls.mjs';
    const pem = fs.readFileSync('.github/release/certs/tdsql-c-mysql-ca.pem', 'utf8');
    const ca = validateCa(pem);
    assert.equal(ca.cdb.fingerprint256.replaceAll(':',''), CDB_PIN);
    assert.equal(ca.root.fingerprint256.replaceAll(':',''), ROOT_PIN);
    assert.throws(() => validateCa(pem + '\\n-----BEGIN PRIVATE KEY-----'));
    assert.throws(() => validateCa(ca.root.toString()));
    const raw = 'OTHER=unchanged\\r\\nDATABASE_URL="mysql://qa:p$&@db.example:3306/ecfc?connection_limit=7"\\r\\nLAST=unchanged\\r\\n';
    const changed = strictConfiguration(raw);
    const url = new URL(changed.url);
    assert.equal(url.password, 'p$&');
    assert.equal(url.username, 'qa');
    assert.equal(url.hostname, 'db.example');
    assert.equal(url.searchParams.get('connection_limit'), '7');
    assert.equal(url.searchParams.get('sslaccept'), 'strict');
    assert.equal(url.searchParams.get('prefer_socket'), 'false');
    assert.equal(url.searchParams.get('sslcert'), '/home/apps/easonfansclub/shared/database-ca.pem');
    assert.ok(changed.nextEnv.startsWith('OTHER=unchanged\\r\\n'));
    assert.ok(changed.nextEnv.endsWith('\\r\\nLAST=unchanged\\r\\n'));
    assert.ok(changed.nextEnv.includes('p$&@'));
    assert.throws(() => strictConfiguration(raw + 'DATABASE_URL="mysql://duplicate:x@db.example/ecfc"'));
    assert.throws(() => verifyPeer('Verify return code: 0 (ok)', 0, 'db.example', pem));
    assert.throws(() => verifyPeer(pem + '\\nVerify return code: 19 (untrusted)', 1, 'db.example', pem));
    try { verifyPeer('verify error:num=62:hostname mismatch', 1, 'db.example', pem); assert.fail('verification must reject'); }
    catch (error) { assert.deepEqual(error.evidence.verifyCodes, [62]); assert.equal(error.evidence.leafCertificateSha256, 'UNKNOWN'); assert.ok(!JSON.stringify(error.evidence).includes('db.example')); }
    const workflow = fs.readFileSync('.github/workflows/production-rc14-tdsql-tls.yml','utf8');
    for (const required of ['environment: Production','group: production-deploy','flock --exclusive --nonblock','git/ref/heads/main','StrictHostKeyChecking=yes']) assert.ok(workflow.includes(required));
    assert.ok(!workflow.includes('pm2 restart'));
  `], { cwd: process.cwd(), stdio: 'pipe' })
})

test('runner stdin imports cannot trigger production configuration', () => {
  execFileSync(process.execPath, ['--input-type=module', '-'], {
    input: "import { validateCa } from './.github/release/rc14-tdsql-tls.mjs'; if (typeof validateCa !== 'function') throw Error('IMPORT_FAILED');",
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
  })
})

test('Linux OpenSSL reads the pinned CA through an anonymous pipe, without a production file', { skip: process.platform !== 'linux' }, () => {
  const pem = fs.readFileSync('.github/release/certs/tdsql-c-mysql-ca.pem', 'utf8')
  const output = execFileSync('/bin/bash', ['-c', 'set -o pipefail; /bin/cat | /usr/bin/openssl "$@"', 'rc14-openssl',
    'x509', '-in', '/dev/stdin', '-noout', '-fingerprint', '-sha256'], { input: pem, encoding: 'utf8' })
  assert.ok(output.replaceAll(':', '').includes('1FA929BBD66489637E008E61D070DCC47A4AF5DBFC8BBE086E6F32864C921956'))
  const source = fs.readFileSync('.github/release/rc14-tdsql-tls.mjs', 'utf8')
  assert.ok(source.includes('set -o pipefail; /bin/cat | /usr/bin/openssl "$@"'))
  for (const flag of ['-verify_return_error', '-verify_hostname', '-verify_ip', '-CAfile']) assert.ok(source.includes(flag))
})
