import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prismaLog: Prisma.PrismaClientOptions['log'] =
  process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']

const useDriverAdapter = process.env.PRISMA_USE_DRIVER_ADAPTER === 'true'

const createPrismaClient = () => {
  if (useDriverAdapter) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL ?? '',
      maxUses: 1,
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

export const prisma = useDriverAdapter ? createPrismaClient() : (globalForPrisma.prisma ?? createPrismaClient())

if (!useDriverAdapter) {
  globalForPrisma.prisma = prisma
}
