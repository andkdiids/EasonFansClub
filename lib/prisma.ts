import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prismaLog: Prisma.PrismaClientOptions['log'] =
  process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']

const useDriverAdapter = process.env.PRISMA_USE_DRIVER_ADAPTER === 'true'

const createPrismaClient = () => {
  if (useDriverAdapter) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL ?? '',
      max: Number(process.env.PRISMA_POOL_MAX || 2),
      idleTimeoutMillis: Number(process.env.PRISMA_POOL_IDLE_TIMEOUT_MS || 10000),
      connectionTimeoutMillis: Number(process.env.PRISMA_POOL_CONNECTION_TIMEOUT_MS || 5000),
      allowExitOnIdle: true,
    })

    return new PrismaClient({
      adapter,
      log: prismaLog,
    })
  }

  return new PrismaClient({
    log: prismaLog,
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

globalForPrisma.prisma = prisma
