export const PASSWORD_SECURITY_QA_DATABASE = 'ecfc_password_recovery_qa_20261020'
export const PASSWORD_SECURITY_QA_PORT = 33307

const forbiddenFallbackNames = [
  'DATABASE_URL',
  'DIRECT_URL',
  'SHADOW_DATABASE_URL',
  'TEST_DATABASE_URL',
  'PRISMA_DATABASE_URL',
  'MYSQL_URL',
  'DB_URL',
  'MYSQL_TEST_URL',
  'MIGRATION_MYSQL_URL',
  'TOPIC_V2_MYSQL_URL',
  'TOPIC_V2_LOTTERY_MYSQL_URL',
]

function fail(code) {
  const error = new Error(code)
  error.code = code
  return error
}

/**
 * Resolve only an explicitly approved, local Password Security QA target.
 * The caller must separately prove that the selected loopback port belongs to
 * the isolated QA mysqld process before opening a connection.
 */
export function resolvePasswordSecurityMysqlQaTarget(env) {
  if (env.PASSWORD_SECURITY_MYSQL_QA !== '1') throw fail('QA_GATE_REQUIRED')
  for (const name of forbiddenFallbackNames) {
    if (env[name] !== undefined && env[name] !== '') throw fail('DATABASE_FALLBACK_FORBIDDEN')
  }

  const rawUrl = env.PASSWORD_SECURITY_MYSQL_URL
  const declaredPort = env.PASSWORD_SECURITY_MYSQL_QA_PORT
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) throw fail('EXPLICIT_QA_URL_REQUIRED')
  if (declaredPort !== String(PASSWORD_SECURITY_QA_PORT)) throw fail('FIXED_QA_PORT_REQUIRED')
  if (rawUrl.includes('?') || rawUrl.includes('#')) throw fail('URL_QUERY_OR_FRAGMENT_FORBIDDEN')

  const schemeSeparator = rawUrl.indexOf('://')
  if (schemeSeparator < 0) throw fail('QA_URL_INVALID')
  if (rawUrl.slice(0, schemeSeparator) !== 'mysql') throw fail('MYSQL_PROTOCOL_REQUIRED')
  const authorityAndPath = rawUrl.slice(schemeSeparator + 3)
  const rawAuthority = authorityAndPath.split(/[/?#]/u, 1)[0]
  const rawHostPort = rawAuthority.slice(rawAuthority.lastIndexOf('@') + 1)
  const rawHostPortMatch = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/u.exec(rawHostPort)
  if (!rawHostPortMatch) throw fail('LOOPBACK_IPV4_REQUIRED')
  if (rawHostPortMatch[1] !== String(PASSWORD_SECURITY_QA_PORT)) throw fail('FIXED_QA_PORT_REQUIRED')

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw fail('QA_URL_INVALID')
  }

  if (url.protocol !== 'mysql:') throw fail('MYSQL_PROTOCOL_REQUIRED')
  if (url.hostname !== '127.0.0.1') throw fail('LOOPBACK_IPV4_REQUIRED')
  if (url.port !== String(PASSWORD_SECURITY_QA_PORT)) throw fail('FIXED_QA_PORT_REQUIRED')
  if (url.pathname !== `/${PASSWORD_SECURITY_QA_DATABASE}`) throw fail('DATABASE_NAME_NOT_ALLOWLISTED')
  if (url.search !== '' || url.hash !== '') throw fail('URL_QUERY_OR_FRAGMENT_FORBIDDEN')
  if (!url.username) throw fail('QA_USERNAME_REQUIRED')

  return Object.freeze({
    connectionUrl: rawUrl,
    host: '127.0.0.1',
    port: PASSWORD_SECURITY_QA_PORT,
    database: PASSWORD_SECURITY_QA_DATABASE,
    protocol: 'mysql:',
  })
}
