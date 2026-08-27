const REQUIRED_TEST_DATABASE_NAME = 'easonfansclub_anywhere_door_test'
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const REFERENCE_DATABASE_ENV_NAMES = [
  'DATABASE_URL',
  'MYSQL_TEST_URL',
  'MIGRATION_MYSQL_URL',
  'MIGRATION_PREFLIGHT_DATABASE_URL',
  'DIRECT_URL',
] as const

type PocDatabaseEnvironment = 'local-test' | 'staging-test'
type EnvironmentValues = Readonly<Record<string, string | undefined>>

export type SafePocDatabaseTarget = {
  environment: PocDatabaseEnvironment
  databaseUrl: string
  host: string
  databaseName: string
}

type DatabaseTarget = {
  host: string
  port: number
  databaseName: string
  signature: string
}

function abortUnsafeDatabase(): never {
  throw new Error('ABORT_UNSAFE_DATABASE')
}

function parseDatabaseTarget(rawUrl: string, requireTestDatabaseName = true): DatabaseTarget {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return abortUnsafeDatabase()
  }

  if (parsed.protocol !== 'mysql:') return abortUnsafeDatabase()

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const port = Number(parsed.port || 3306)
  let databaseName: string
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return abortUnsafeDatabase()
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || (requireTestDatabaseName && databaseName !== REQUIRED_TEST_DATABASE_NAME)) {
    return abortUnsafeDatabase()
  }

  return {
    host,
    port,
    databaseName,
    signature: `${host}:${port}/${databaseName}`,
  }
}

function configuredReferenceTargets(env: EnvironmentValues) {
  return REFERENCE_DATABASE_ENV_NAMES.flatMap((name) => {
    const value = env[name]?.trim()
    if (!value) return []
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return abortUnsafeDatabase()
    }
    if (parsed.protocol !== 'mysql:') return []
    return [parseDatabaseTarget(value, false)]
  })
}

/**
 * Return a database target only when the caller has explicitly selected an
 * isolated test environment and database. It intentionally does not fall back
 * to DATABASE_URL or any migration URL.
 */
export function assertSafePocDatabaseTarget(env: EnvironmentValues = process.env): SafePocDatabaseTarget {
  const environment = (env.ANYWHERE_DOOR_TEST_DATABASE_ENV || '').trim().toLowerCase()
  const databaseUrl = (env.ANYWHERE_DOOR_TEST_DATABASE_URL || '').trim()
  if (environment !== 'local-test' && environment !== 'staging-test') return abortUnsafeDatabase()
  if (!databaseUrl) return abortUnsafeDatabase()

  const target = parseDatabaseTarget(databaseUrl)
  if (environment === 'local-test' && !LOCAL_DATABASE_HOSTS.has(target.host)) return abortUnsafeDatabase()

  const references = configuredReferenceTargets(env)
  if (references.some((reference) => reference.signature === target.signature)) return abortUnsafeDatabase()

  return {
    environment,
    databaseUrl,
    host: target.host,
    databaseName: target.databaseName,
  }
}

export { REQUIRED_TEST_DATABASE_NAME }
