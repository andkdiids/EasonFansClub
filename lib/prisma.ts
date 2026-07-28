import { PrismaClient, type Prisma } from '@prisma/client'

const prismaLog: Prisma.PrismaClientOptions['log'] =
  process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']

const wantsDriverAdapter = process.env.PRISMA_USE_DRIVER_ADAPTER === 'true'

function databaseUrlForPrismaClient() {
  const value = process.env.DATABASE_URL
  if (!value) {
    console.warn('[prisma] 当前进程未设置 DATABASE_URL；首次数据库查询将失败。')
    return undefined
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'mysql:') {
      throw new Error(`[prisma] DATABASE_URL 必须指向 MySQL，当前协议为 ${url.protocol}`)
    }
    if (wantsDriverAdapter) {
      console.warn('[prisma] 已忽略 PostgreSQL driver adapter 配置；当前应用使用 MySQL DATABASE_URL。')
    }
    return value
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[prisma]')) throw error
    throw new Error('[prisma] DATABASE_URL 格式无效')
  }
}

const createPrismaClient = () => {
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
