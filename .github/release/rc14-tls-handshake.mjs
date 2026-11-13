import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const APP = '/home/apps/easonfansclub'

export function handshakeOptions(raw) {
  const lines = raw.split(/\r?\n/).filter(line => /^\s*DATABASE_URL\s*=/.test(line))
  if (lines.length !== 1) throw Error('CONFIGURATION_INVALID')
  let value = lines[0].slice(lines[0].indexOf('=') + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  const url = new URL(value)
  if (url.protocol !== 'mysql:' || !/^[A-Za-z0-9.-]+$/.test(url.hostname) || url.hash) throw Error('CONFIGURATION_INVALID')
  const ca = url.searchParams.get('sslcert')
  if (ca && !['/etc/ssl/certs/ca-certificates.crt', `${APP}/shared/database-ca.pem`].includes(ca)) throw Error('CA_PATH_UNAPPROVED')
  const args = ['s_client', '-starttls', 'mysql', '-connect', `${url.hostname}:${url.port || '3306'}`, '-servername', url.hostname,
    ...(net.isIP(url.hostname) ? ['-verify_ip', url.hostname] : ['-verify_hostname', url.hostname]), '-verify_return_error', '-showcerts']
  if (ca) args.push('-CAfile', ca)
  return { args, hostname: url.hostname, configuredCa: Boolean(ca), ca }
}

export function summarizeHandshake(result, hostname) {
  const text = String(result.stdout || '') + '\n' + String(result.stderr || '')
  const verify = [...text.matchAll(/(?:Verify return code:\s*|verify error:num=)(\d+)/g)].map(match => Number(match[1]))
  const failure = verify.find(code => code !== 0)
  const pem = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0]
  let identity = 'UNKNOWN', fingerprint = 'UNKNOWN'
  if (pem) {
    try {
      const cert = new X509Certificate(pem)
      identity = (net.isIP(hostname) ? cert.checkIP(hostname) : cert.checkHost(hostname)) ? 'MATCH' : 'MISMATCH'
      fingerprint = cert.fingerprint256.replaceAll(':', '')
    } catch { /* no untrusted parser text is emitted */ }
  }
  return { status: result.status === 0 && failure === undefined && verify.includes(0) && identity === 'MATCH' ? 'PASS' : 'FAILED_CLOSED',
    verifyCode: failure ?? (verify.includes(0) ? 0 : 'UNKNOWN'), hostnameIdentity: identity, leafCertificateSha256: fingerprint,
    serverTlsSupport: /does not support SSL|doesn't support SSL|does not support TLS/i.test(text) ? 'NOT_SUPPORTED' : pem ? 'SUPPORTED' : 'UNKNOWN',
    timeout: result.error?.code === 'ETIMEDOUT', databaseAuthenticationSent: false, sqlExecuted: false }
}

function trusted(file, privateFile = false) {
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || ![0, process.getuid()].includes(stat.uid) || (stat.mode & 0o022)) throw Error('PARENT_METADATA_UNSAFE')
    if (directory === '/') break
  }
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || ![0, process.getuid()].includes(stat.uid) || (stat.mode & (privateFile ? 0o077 : 0o022)) || stat.size > 1048576) throw Error('FILE_METADATA_UNSAFE')
}
function runtime() {
  const link = `${APP}/current`
  if (!fs.lstatSync(link).isSymbolicLink()) throw Error('RELEASE_PATH_INVALID')
  const release = path.posix.resolve(APP, fs.readlinkSync(link))
  if (!new RegExp(`^${APP}/releases/[A-Za-z0-9._-]+$`).test(release)) throw Error('RELEASE_PATH_INVALID')
  trusted(`${release}/.deployed-sha`)
  return { release, sha: fs.readFileSync(`${release}/.deployed-sha`, 'utf8').trim() }
}
function main(expectedSha) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha || '')) throw Error('EXPECTED_SHA_INVALID')
  const before = runtime()
  if (before.sha !== expectedSha) throw Error('PRODUCTION_SHA_CAS_MISMATCH')
  trusted(`${APP}/shared/.env`, true)
  const options = handshakeOptions(fs.readFileSync(`${APP}/shared/.env`, 'utf8'))
  if (options.ca) trusted(options.ca)
  const result = spawnSync('/usr/bin/openssl', options.args, { input: '', encoding: 'utf8', timeout: 15000, maxBuffer: 2097152, shell: false,
    env: { PATH: '/usr/bin:/bin', LANG: 'C' } })
  const after = runtime()
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('PRODUCTION_CHANGED')
  const childVersion = spawnSync('/usr/bin/node', ['--version'], { encoding: 'utf8', timeout: 5000, shell: false }).stdout?.trim()
  console.log(JSON.stringify({ scope: 'READONLY_MYSQL_STARTTLS', productionSha: before.sha, nodeVersion: process.version,
    strictChildNodeVersion: /^v\d+\.\d+\.\d+$/.test(childVersion || '') ? childVersion : 'UNKNOWN',
    configuredCa: options.configuredCa, ...summarizeHandshake(result, options.hostname) }))
}
if (process.argv[1] === '-' || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try { main(process.argv[2]) }
  catch (error) { console.log(JSON.stringify({ status: 'FAILED_CLOSED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'HANDSHAKE_DIAGNOSTIC_UNAVAILABLE' })); process.exitCode = 1 }
}
