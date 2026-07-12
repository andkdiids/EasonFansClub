import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prismaLog: Prisma.PrismaClientOptions['log'] =
  process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']

const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL)
const wantsDriverAdapter = process.env.PRISMA_USE_DRIVER_ADAPTER === 'true'
const useDriverAdapter = wantsDriverAdapter && !isVercelRuntime

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function databaseUrlForPrismaClient() {
  const value = process.env.DATABASE_URL
  if (!value) return undefined

  try {
    const url = new URL(value)
    const isSupabasePooler = url.hostname.endsWith('.pooler.supabase.com') || url.port === '6543'
    if (!isSupabasePooler) return value

    if (!url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true')
    }
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1')
    }
    return url.toString()
  } catch {
    return value
  }
}

const createPrismaClient = () => {
  if (wantsDriverAdapter && isVercelRuntime) {
    console.warn('[prisma] Ignoring PRISMA_USE_DRIVER_ADAPTER on Vercel; using standard PrismaClient.')
  }

  if (useDriverAdapter) {
    const connectionString = process.env.HYPERDRIVE_DATABASE_URL || process.env.DATABASE_URL || ''
    const adapter = new PrismaPg({
      connectionString,
      max: numberFromEnv('PRISMA_POOL_MAX', 1),
      maxUses: numberFromEnv('PRISMA_POOL_MAX_USES', 1),
      idleTimeoutMillis: numberFromEnv('PRISMA_POOL_IDLE_TIMEOUT_MS', 1000),
      connectionTimeoutMillis: numberFromEnv('PRISMA_POOL_CONNECTION_TIMEOUT_MS', 2500),
      query_timeout: numberFromEnv('PRISMA_QUERY_TIMEOUT_MS', 3500),
      statement_timeout: numberFromEnv('PRISMA_STATEMENT_TIMEOUT_MS', 3500),
      idle_in_transaction_session_timeout: numberFromEnv('PRISMA_IDLE_TRANSACTION_TIMEOUT_MS', 3500),
      allowExitOnIdle: true,
    }, {
      onPoolError(error) {
        console.error('[prisma.pool]', error)
      },
      onConnectionError(error) {
        console.error('[prisma.connection]', error)
      },
    })

    return new PrismaClient({
      adapter,
      log: prismaLog,
    })
  }

  const databaseUrl = databaseUrlForPrismaClient()
  return new PrismaClient({
    log: prismaLog,
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

globalForPrisma.prisma = prisma
