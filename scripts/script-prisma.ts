import { loadEnvFile } from 'node:process'

export async function getScriptPrisma() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  return (await import('../lib/prisma')).prisma
}
