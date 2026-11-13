import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { createHash, X509Certificate } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const APP = '/home/apps/easonfansclub'
const CA_PATH = `${APP}/shared/database-ca.pem`
const CA_PEM = '__RC14_CA_PEM__'
export const CDB_PIN = '1FA929BBD66489637E008E61D070DCC47A4AF5DBFC8BBE086E6F32864C921956'
export const ROOT_PIN = '70E2E9FCC3067F87CBB54BB1D9AAEC2547F15FF483BEA1EC8C5C67401F726F01'
const fingerprint = cert => cert.fingerprint256.replaceAll(':', '')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const certs = pem => (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map(p => new X509Certificate(p))
class PeerVerificationError extends Error {
  constructor(code, evidence) { super(code); this.evidence = evidence }
}

export function validateCa(pem) {
  if (/PRIVATE KEY/.test(pem)) throw Error('PRIVATE_KEY_FORBIDDEN')
  const chain = certs(pem)
  if (chain.length !== 2 || !chain.every(c => c.ca && Date.parse(c.validFrom) <= Date.now() && Date.parse(c.validTo) > Date.now())) throw Error('CA_BUNDLE_INVALID')
  const cdb = chain.find(c => fingerprint(c) === CDB_PIN), root = chain.find(c => fingerprint(c) === ROOT_PIN)
  if (!cdb || !root || !cdb.checkIssued(root) || !cdb.verify(root.publicKey) || !root.checkIssued(root) || !root.verify(root.publicKey)) throw Error('CA_SIGNATURE_OR_PIN_INVALID')
  return { cdb, root }
}
export function strictConfiguration(raw) {
  const matches = [...raw.matchAll(/^[ \t]*DATABASE_URL[ \t]*=([^\r\n]*)/gm)]
  if (matches.length !== 1) throw Error('DATABASE_URL_AMBIGUOUS')
  let value = matches[0][1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  const url = new URL(value)
  if (url.protocol !== 'mysql:' || !/^[A-Za-z0-9.-]+$/.test(url.hostname) || url.hash) throw Error('DATABASE_URL_INVALID')
  const identity = [url.hostname, url.port, url.username, url.password, url.pathname]
  url.searchParams.set('sslaccept', 'strict')
  url.searchParams.set('sslcert', CA_PATH)
  url.searchParams.set('prefer_socket', 'false')
  if (JSON.stringify(identity) !== JSON.stringify([url.hostname, url.port, url.username, url.password, url.pathname])) throw Error('DATABASE_IDENTITY_CHANGED')
  return { url: url.toString(), hostname: url.hostname, port: url.port || '3306', nextEnv: raw.replace(matches[0][0], () => `DATABASE_URL="${url.toString()}"`) }
}
export function verifyPeer(output, status, hostname, pem) {
  const { cdb, root } = validateCa(pem)
  const peers = certs(output)
  const leaf = peers[0]
  const codes = [...output.matchAll(/(?:Verify return code:\s*|verify error:num=)(\d+)/g)].map(m => Number(m[1]))
  const evidence = {
    opensslExitStatus: Number.isInteger(status) ? status : 'UNKNOWN',
    verifyCodes: codes.filter(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000).slice(0, 16),
    peerCertificateCount: peers.length,
    endpointKind: ['localhost', '127.0.0.1'].includes(hostname) ? 'LOOPBACK' : net.isIP(hostname) ? 'IP' : 'DNS',
    leafCertificateSha256: leaf ? fingerprint(leaf) : 'UNKNOWN',
    hostnameMatch: leaf ? Boolean(net.isIP(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname)) : 'UNKNOWN',
    leafCdbSignatureVerified: leaf ? Boolean(leaf.checkIssued(cdb) && leaf.verify(cdb.publicKey)) : 'UNKNOWN',
    caLoadFailed: /error setting certificate|no certificate or crl|unable to load certificate/i.test(output),
    peerClosed: /unexpected eof|read:errno=/i.test(output),
  }
  const fail = code => { throw new PeerVerificationError(code, evidence) }
  if (status !== 0 || !codes.includes(0) || codes.some(n => n !== 0) || !leaf) fail('TLS_CHAIN_VERIFICATION_FAILED')
  if (!evidence.hostnameMatch) fail('TLS_HOSTNAME_MISMATCH')
  const walk = (child, seen = new Set()) => {
    const pin = fingerprint(child)
    if (seen.has(pin) || seen.size > 8) return false
    const next = new Set([...seen, pin])
    if (pin === ROOT_PIN) return next.has(CDB_PIN)
    return [...peers, cdb, root].some(parent => parent.ca && child.checkIssued(parent) && child.verify(parent.publicKey) && walk(parent, next))
  }
  if (!walk(leaf)) fail('PEER_NOT_SIGNED_BY_APPROVED_CDB_CHAIN')
  return { leafCertificateSha256: fingerprint(leaf), cdbCaSha256: CDB_PIN, rootCaSha256: ROOT_PIN, hostnameVerified: true, chainVerified: true }
}
function trusted(file, isPrivate = false) {
  for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
    const s = fs.lstatSync(dir)
    if (!s.isDirectory() || s.isSymbolicLink() || ![0, process.getuid()].includes(s.uid) || (s.mode & 0o022)) throw Error('PARENT_UNSAFE')
    if (dir === '/') break
  }
  const s = fs.lstatSync(file)
  if (!s.isFile() || s.isSymbolicLink() || ![0, process.getuid()].includes(s.uid) || (s.mode & (isPrivate ? 0o077 : 0o022)) || s.size > 1048576) throw Error('FILE_UNSAFE')
  return s
}
function runtime(expected) {
  if (!/^[0-9a-f]{40}$/.test(expected || '')) throw Error('EXPECTED_SHA_INVALID')
  if (!fs.lstatSync(`${APP}/current`).isSymbolicLink()) throw Error('CURRENT_LINK_INVALID')
  const release = path.posix.resolve(APP, fs.readlinkSync(`${APP}/current`))
  if (!new RegExp(`^${APP}/releases/[A-Za-z0-9._-]+$`).test(release)) throw Error('RELEASE_PATH_INVALID')
  trusted(`${release}/.deployed-sha`)
  if (fs.readFileSync(`${release}/.deployed-sha`, 'utf8').trim() !== expected) throw Error('PRODUCTION_SHA_CAS_MISMATCH')
  return release
}
async function main(expected, mode) {
  if (!['verify', 'install'].includes(mode)) throw Error('MODE_INVALID')
  const release = runtime(expected), envPath = `${APP}/shared/.env`
  const stat = trusted(envPath, true), original = fs.readFileSync(envPath)
  const raw = original.toString('utf8')
  if (!Buffer.from(raw).equals(original)) throw Error('ENV_ENCODING_INVALID')
  const config = strictConfiguration(raw)
  validateCa(CA_PEM)
  const result = spawnSync('/usr/bin/openssl', ['s_client', '-starttls', 'mysql', '-connect', `${config.hostname}:${config.port}`, '-servername', config.hostname,
    ...(net.isIP(config.hostname) ? ['-verify_ip', config.hostname] : ['-verify_hostname', config.hostname]), '-verify_return_error', '-showcerts', '-prexit', '-CAfile', '/dev/stdin'],
  { input: CA_PEM, encoding: 'utf8', timeout: 15000, maxBuffer: 2097152, shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C' } })
  const proof = verifyPeer(String(result.stdout || '') + '\n' + String(result.stderr || ''), result.status, config.hostname, CA_PEM)
  if (runtime(expected) !== release || !fs.readFileSync(envPath).equals(original)) throw Error('ENV_OR_RELEASE_CHANGED')
  if (mode === 'verify') { console.log(JSON.stringify({ result: 'APPROVED_CA_PEER_VERIFIED', ...proof, productionWrites: 'NONE', databaseAuthenticationSent: false })); return }
  let created = false, db, committed = false
  const nonce = `${process.pid}-${Date.now()}`, tmp = `${envPath}.rc14-tls-${nonce}`, backup = `${envPath}.rc14-tls-${nonce}.backup`
  try {
    if (fs.existsSync(CA_PATH)) {
      const caStat = trusted(CA_PATH)
      if (fs.readFileSync(CA_PATH, 'utf8') !== CA_PEM) throw Error('EXISTING_CA_DIFFERS')
      if ((caStat.mode & 0o7777) !== 0o444 && caStat.uid !== process.getuid()) throw Error('CA_MODE_REQUIRES_OWNER')
    } else { fs.writeFileSync(CA_PATH, CA_PEM, { flag: 'wx', mode: 0o444, flush: true }); created = true }
    const client = createRequire(`${release}/package.json`)(`${release}/node_modules/@prisma/client`)
    const probeUrl = new URL(config.url)
    for (const [key, value] of Object.entries({ connection_limit: '1', connect_timeout: '5', pool_timeout: '5', socket_timeout: '10' })) probeUrl.searchParams.set(key, value)
    db = new client.PrismaClient({ log: [], errorFormat: 'minimal', datasources: { db: { url: probeUrl.toString() } } })
    await db.$connect()
    const rows = await db.$queryRawUnsafe("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
    if (!rows[0]?.Value || !/^[A-Za-z0-9_-]+$/.test(rows[0].Value)) throw Error('PRISMA_CONNECTION_NOT_ENCRYPTED')
    await db.$disconnect(); db = undefined
    const currentStat = trusted(envPath, true)
    if (runtime(expected) !== release || !fs.readFileSync(envPath).equals(original) || currentStat.ino !== stat.ino || currentStat.uid !== stat.uid || currentStat.gid !== stat.gid) throw Error('ENV_CAS_MISMATCH')
    trusted(CA_PATH)
    if (hash(fs.readFileSync(CA_PATH)) !== hash(CA_PEM)) throw Error('CA_CAS_MISMATCH')
    fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600, flush: true })
    fs.writeFileSync(tmp, config.nextEnv, { flag: 'wx', mode: 0o600, flush: true })
    fs.chownSync(tmp, stat.uid, stat.gid)
    fs.renameSync(tmp, envPath); committed = true
    if ((fs.lstatSync(CA_PATH).mode & 0o7777) !== 0o444) fs.chmodSync(CA_PATH, 0o444)
    console.log(JSON.stringify({ result: 'STRICT_PRISMA_TLS_CONFIGURED', ...proof, caFileMode: '0444', encryptedPrismaQuery: true, configurationBackup: path.posix.basename(backup), productionSha: expected }))
  } finally {
    if (db) await db.$disconnect().catch(() => undefined)
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    if (!committed && created && fs.existsSync(CA_PATH) && hash(fs.readFileSync(CA_PATH)) === hash(CA_PEM)) fs.unlinkSync(CA_PATH)
  }
}
if ((process.argv[1] === '-' && path.basename(fileURLToPath(import.meta.url)) === '[eval1]') ||
    (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  const keepAlive = setInterval(() => {}, 1000)
  main(process.argv[2], process.argv[3]).catch(error => {
    const code = error.code || error.errorCode
    console.log(JSON.stringify({ result: 'FAILED_CLOSED', code: /^P\d{4}$/.test(code || '') ? code : /^[A-Z_]+$/.test(error.message || '') ? error.message : 'TLS_CONFIGURATION_FAILED',
      ...(error instanceof PeerVerificationError ? { evidence: error.evidence } : {}) })); process.exitCode = 1
  }).finally(() => clearInterval(keepAlive))
}
