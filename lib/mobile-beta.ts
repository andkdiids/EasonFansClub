import { createHash, randomBytes, randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const BETA_ACCESS_PERMISSION = 'beta_access_manage' as const
export const BETA_CONFIG_KEY = 'mobile.betaAccess.required'
export const BETA_CLIENT_HEADER = 'x-ecfc-client'
export const BETA_APP_VERSION_HEADER = 'x-ecfc-app-version'
export const BETA_TOKEN_HEADER = 'x-ecfc-beta-token'
export const BETA_INSTALLATION_HEADER = 'x-ecfc-beta-installation-id'
export const BETA_CLIENT_NAME = 'android'
export const BETA_APP_VERSION = '1.0.0-beta.1'
export const BETA_OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000

const CODE_PREFIX = 'ECFC'
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_BODY_LENGTH = 12

export type BetaGateConfig = {
  betaAccessRequired: boolean
}

export type BetaInviteStatusValue = 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED'

export class BetaAccessError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'BetaAccessError'
    this.code = code
    this.status = status
  }
}

type SiteSettingStore = Pick<Prisma.TransactionClient, 'siteSetting'>

export async function getBetaAccessConfig(database: SiteSettingStore = prisma): Promise<BetaGateConfig> {
  const row = await database.siteSetting.findUnique({ where: { key: BETA_CONFIG_KEY }, select: { value: true } })
  // Secure-by-default: the first new Mobile build requires an invitation until
  // an administrator deliberately turns the gate off.
  return { betaAccessRequired: row ? row.value === 'true' : true }
}

export async function setBetaAccessRequired(required: boolean, database: SiteSettingStore = prisma) {
  await database.siteSetting.upsert({
    where: { key: BETA_CONFIG_KEY },
    update: { value: String(required), valueType: 'BOOLEAN', group: 'mobile', label: 'Android 内测准入' },
    create: { key: BETA_CONFIG_KEY, value: String(required), valueType: 'BOOLEAN', group: 'mobile', label: 'Android 内测准入' },
  })
  return { betaAccessRequired: required }
}

export function parseBetaGateConfig(value: unknown): BetaGateConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  return typeof input.betaAccessRequired === 'boolean' ? { betaAccessRequired: input.betaAccessRequired } : null
}

export function hashBetaValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeInstallationId(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized) ? normalized : null
}

export function hashInstallationId(value: string) {
  return hashBetaValue(value)
}

function formatCodeBody(body: string) {
  return `${CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`
}

export function normalizeBetaInviteCode(value: unknown) {
  if (typeof value !== 'string') return null
  const compact = value.normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const body = compact.startsWith(CODE_PREFIX) ? compact.slice(CODE_PREFIX.length) : compact
  if (body.length !== CODE_BODY_LENGTH || [...body].some((char) => !CODE_ALPHABET.includes(char))) return null
  return formatCodeBody(body)
}

export function maskBetaInviteCode(code: string) {
  const normalized = normalizeBetaInviteCode(code)
  if (!normalized) return 'ECFC-••••-••••-••••'
  const body = normalized.replace(/[^A-Z0-9]/g, '').slice(CODE_PREFIX.length)
  return `${CODE_PREFIX}-${body.slice(0, 4)}••••${body.slice(-4)}`
}

export function generateBetaInviteCode() {
  let body = ''
  for (let index = 0; index < CODE_BODY_LENGTH; index += 1) body += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  const code = formatCodeBody(body)
  return { code, codeHash: hashBetaValue(code), maskedCode: maskBetaInviteCode(code), codePrefix: `${CODE_PREFIX}-${body.slice(0, 4)}` }
}

export function createBetaCredential() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashBetaValue(token) }
}

function inviteIsExpired(expiresAt: Date | null, now: Date) {
  return Boolean(expiresAt && expiresAt <= now)
}

export function deriveBetaInviteStatus(input: { status: BetaInviteStatusValue; expiresAt: Date | null; activationCount: number; maxActivations: number }, now = new Date()): BetaInviteStatusValue {
  if (input.status === 'REVOKED') return 'REVOKED'
  if (inviteIsExpired(input.expiresAt, now)) return 'EXPIRED'
  if (input.activationCount >= input.maxActivations) return 'USED'
  return 'ACTIVE'
}

function assertValidInstallation(value: unknown) {
  const installationId = normalizeInstallationId(value)
  if (!installationId) throw new BetaAccessError('INVALID_INSTALLATION_ID', '安装实例标识无效', 400)
  return installationId
}

function assertInviteUsable(invite: { status: BetaInviteStatusValue; expiresAt: Date | null; activationCount: number; maxActivations: number }, now: Date) {
  const status = deriveBetaInviteStatus(invite, now)
  if (status === 'REVOKED') throw new BetaAccessError('BETA_REVOKED', '该内测资格已失效', 410)
  if (status === 'EXPIRED') throw new BetaAccessError('BETA_EXPIRED', '该内测码已过期', 410)
  if (status === 'USED') throw new BetaAccessError('BETA_USED', '该内测码已被使用', 409)
}

type ActivationResult = {
  credential: string
  expiresAt: string | null
  maskedCode: string
}

export async function activateBetaInvite(input: { code: unknown; installationId: unknown }, now = new Date()): Promise<ActivationResult> {
  const code = normalizeBetaInviteCode(input.code)
  if (!code) throw new BetaAccessError('BETA_INVALID', '内测码无效，请检查后重试', 400)
  const installationId = assertValidInstallation(input.installationId)
  const codeHash = hashBetaValue(code)
  const installationIdHash = hashInstallationId(installationId)

  return prisma.$transaction(async (tx) => {
    const invite = await tx.betaInviteCode.findUnique({
      where: { codeHash },
      select: { id: true, maskedCode: true, status: true, maxActivations: true, activationCount: true, expiresAt: true },
    })
    if (!invite) throw new BetaAccessError('BETA_INVALID', '内测码无效，请检查后重试', 400)

    const existing = await tx.betaDeviceActivation.findUnique({
      where: { inviteCodeId_installationIdHash: { inviteCodeId: invite.id, installationIdHash } },
      select: { id: true, status: true },
    })
    if (existing) {
      if (existing.status === 'REVOKED' || invite.status === 'REVOKED') throw new BetaAccessError('BETA_REVOKED', '该内测资格已失效', 410)
      if (inviteIsExpired(invite.expiresAt, now)) throw new BetaAccessError('BETA_EXPIRED', '该内测码已过期', 410)
      const credential = createBetaCredential()
      await tx.betaDeviceActivation.update({ where: { id: existing.id }, data: { credentialHash: credential.tokenHash, lastVerifiedAt: now } })
      return { credential: credential.token, expiresAt: invite.expiresAt?.toISOString() || null, maskedCode: invite.maskedCode }
    }

    assertInviteUsable(invite, now)
    const claimed = await tx.betaInviteCode.updateMany({
      where: {
        id: invite.id,
        status: { in: ['ACTIVE', 'USED'] },
        activationCount: { lt: invite.maxActivations },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        activationCount: { increment: 1 },
      },
    })
    if (claimed.count !== 1) throw new BetaAccessError('BETA_USED', '该内测码已被使用', 409)

    // Read the post-increment value while this transaction still owns the
    // invite row lock. This keeps USED/ACTIVE correct when maxActivations is
    // greater than one and several devices activate concurrently.
    const updatedInvite = await tx.betaInviteCode.findUnique({
      where: { id: invite.id },
      select: { activationCount: true, maxActivations: true },
    })
    if (!updatedInvite) throw new BetaAccessError('BETA_INVALID', '内测码无效，请检查后重试', 400)
    await tx.betaInviteCode.update({
      where: { id: invite.id },
      data: { status: updatedInvite.activationCount >= updatedInvite.maxActivations ? 'USED' : 'ACTIVE' },
    })

    const credential = createBetaCredential()
    await tx.betaDeviceActivation.create({
      data: {
        inviteCodeId: invite.id,
        installationIdHash,
        credentialHash: credential.tokenHash,
        activatedAt: now,
        lastVerifiedAt: now,
      },
    })
    return { credential: credential.token, expiresAt: invite.expiresAt?.toISOString() || null, maskedCode: invite.maskedCode }
  })
}

export async function verifyBetaCredential(input: { credential: unknown; installationId: unknown }, now = new Date()) {
  const credential = typeof input.credential === 'string' ? input.credential.trim() : ''
  if (!credential || credential.length < 40) throw new BetaAccessError('BETA_CREDENTIAL_INVALID', '内测资格无效，请重新验证', 401)
  const installationId = assertValidInstallation(input.installationId)
  const activation = await prisma.betaDeviceActivation.findUnique({
    where: { credentialHash: hashBetaValue(credential) },
    select: {
      id: true,
      installationIdHash: true,
      status: true,
      InviteCode: { select: { status: true, expiresAt: true, activationCount: true, maxActivations: true } },
    },
  })
  if (!activation || activation.installationIdHash !== hashInstallationId(installationId)) throw new BetaAccessError('BETA_CREDENTIAL_INVALID', '内测资格无效，请重新验证', 401)
  if (activation.status === 'REVOKED' || activation.InviteCode.status === 'REVOKED') throw new BetaAccessError('BETA_REVOKED', '你的内测资格已失效', 410)
  if (inviteIsExpired(activation.InviteCode.expiresAt, now)) throw new BetaAccessError('BETA_EXPIRED', '你的内测资格已过期', 410)
  await prisma.betaDeviceActivation.update({ where: { id: activation.id }, data: { lastVerifiedAt: now } })
  return { valid: true as const, expiresAt: activation.InviteCode.expiresAt?.toISOString() || null }
}

export function isMobileBetaClient(request: Request) {
  return request.headers.get(BETA_CLIENT_HEADER)?.trim().toLowerCase() === BETA_CLIENT_NAME
}

function betaErrorResponse(error: BetaAccessError) {
  return NextResponse.json({ ok: false, code: error.code, message: error.message }, {
    status: error.status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function requireMobileBetaAccess(request: Request) {
  if (!isMobileBetaClient(request)) return null
  let config: BetaGateConfig
  try {
    config = await getBetaAccessConfig()
  } catch (error) {
    console.error('[mobile.beta.config]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return betaErrorResponse(new BetaAccessError('BETA_SERVICE_UNAVAILABLE', '内测验证服务暂时不可用，请稍后重试', 503))
  }
  if (!config.betaAccessRequired) return null
  const credential = request.headers.get(BETA_TOKEN_HEADER)
  const installationId = request.headers.get(BETA_INSTALLATION_HEADER)
  if (!credential || !installationId) return betaErrorResponse(new BetaAccessError('BETA_REQUIRED', '请先完成内测验证', 403))
  try {
    await verifyBetaCredential({ credential, installationId })
    return null
  } catch (error) {
    if (error instanceof BetaAccessError) return betaErrorResponse(error)
    console.error('[mobile.beta.verify]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return betaErrorResponse(new BetaAccessError('BETA_SERVICE_UNAVAILABLE', '内测验证服务暂时不可用，请稍后重试', 503))
  }
}

export async function resolveMobileBetaAccess(request: Request) {
  return requireMobileBetaAccess(request)
}

export function betaErrorResponseForRoute(error: unknown, fallback = '内测服务暂时不可用，请稍后重试') {
  if (error instanceof BetaAccessError) return betaErrorResponse(error)
  console.error('[mobile.beta.route]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
  return NextResponse.json({ ok: false, code: 'BETA_SERVICE_UNAVAILABLE', message: fallback }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
