import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getEHospitalCheckConfig } from '@/lib/ehospital-check'
import type { Prisma } from '@prisma/client'
import {
  isValidRegistrationControlOverride,
  normalizeRegistrationControlMode,
  parseRegistrationDailyScheduleInput,
  resolveRegistrationAvailability,
  type RegistrationAvailability,
  type RegistrationControlSettings,
} from '@/lib/registration-availability'

export {
  DEFAULT_REGISTRATION_CLOSED_MESSAGE,
  DEFAULT_REGISTRATION_CLOSED_TITLE,
  formatBeijingDateTimeDisplay,
  formatBeijingDateTimeInput,
  getRegistrationAvailabilityError,
  isValidRegistrationControlMode,
  isValidRegistrationControlOverride,
  isValidRegistrationControlSettings,
  normalizeRegistrationControlMode,
  parseBeijingDateTime,
  parseRegistrationDailyScheduleInput,
  parseRegistrationControlInput,
  REGISTRATION_DAILY_SCHEDULE_VALIDATION_MESSAGE,
  REGISTRATION_ONE_TIME_VALIDATION_MESSAGE,
  registrationAvailabilityStatuses,
  registrationControlModes,
  registrationControlOverrides,
  resolveRegistrationAvailability,
  serializeRegistrationAvailability,
  serializeRegistrationControlSettings,
  validateRegistrationControlSettings,
  validateRegistrationDailySchedule,
} from '@/lib/registration-availability'
export type {
  CanonicalRegistrationControlMode,
  RegistrationAvailability,
  RegistrationAvailabilityPayload,
  RegistrationAvailabilityStatus,
  RegistrationControlMode,
  RegistrationControlOverride,
  RegistrationControlPayload,
  RegistrationControlSettings,
  RegistrationDailyScheduleWindow,
} from '@/lib/registration-availability'

/**
 * Maps a registration-control persistence error to a stable API error payload.
 * Extracted so the admin security-settings route can return readable messages
 * while the mapping itself stays unit-testable outside a Next.js route module.
 */
export function registrationControlWriteError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
  console.error('[registration-control.save]', {
    code,
    message: error instanceof Error ? error.message : 'Unknown database error',
  })

  if (code === 'P2000') {
    return NextResponse.json({
      code: 'REGISTRATION_SETTING_TOO_LONG',
      message: '注册配置内容超出当前数据库字段长度，请先应用 SiteSetting.value 的 TEXT 字段升级。',
    }, { status: 500 })
  }
  if (code === 'P2022') {
    return NextResponse.json({
      code: 'REGISTRATION_SETTING_SCHEMA_INCOMPATIBLE',
      message: '注册配置字段与当前数据库结构不兼容，请检查待执行的数据库迁移。',
    }, { status: 500 })
  }
  if (code === 'P2025') {
    return NextResponse.json({
      code: 'REGISTRATION_SETTING_NOT_FOUND',
      message: '注册配置记录不存在或已变化，请刷新后重试。',
    }, { status: 409 })
  }
  return NextResponse.json({
    code: 'REGISTRATION_SETTING_UPDATE_FAILED',
    message: '数据库更新失败，注册设置未保存，请稍后重试。',
  }, { status: 500 })
}

export const registrationModes = ['PHONE', 'EMAIL', 'BOTH', 'CLOSED'] as const
export type RegistrationMode = (typeof registrationModes)[number]
export type RegistrationType = Extract<RegistrationMode, 'PHONE' | 'EMAIL'>

export const registrationModeLabels: Record<RegistrationMode, string> = {
  PHONE: '仅手机号注册',
  EMAIL: '仅邮箱注册',
  BOTH: '手机号和邮箱均可注册',
  CLOSED: '暂停注册',
}

const registrationModeSettingKey = 'registration.mode'
const registrationLimitSettingKey = 'registrationLimitEnabled'

const registrationControlSettingDefinitions = {
  mode: { key: 'registration.control.mode', defaultValue: 'MANUAL', label: '注册开放模式' },
  dailySchedule: { key: 'registration.control.dailySchedule', defaultValue: '[]', label: '每日注册开放时段' },
  opensAt: { key: 'registration.control.opensAt', defaultValue: '', label: '注册开放开始时间' },
  closesAt: { key: 'registration.control.closesAt', defaultValue: '', label: '注册开放结束时间' },
  override: { key: 'registration.control.override', defaultValue: 'NONE', label: '注册开放状态覆盖' },
  closedTitle: { key: 'registration.control.closedTitle', defaultValue: '当前暂停注册', label: '注册关闭标题' },
  closedMessage: { key: 'registration.control.closedMessage', defaultValue: '注册入口目前暂时关闭，请稍后再来。', label: '注册关闭说明' },
} as const

export function isValidRegistrationMode(value: unknown): value is RegistrationMode {
  return typeof value === 'string' && registrationModes.includes(value as RegistrationMode)
}

export function isRegisterEnvAllowed() {
  return process.env.ALLOW_REGISTER !== 'false'
}

export function isTurnstileEnabled() {
  return process.env.ENABLE_TURNSTILE === 'true' || process.env.NEXT_PUBLIC_ENABLE_TURNSTILE === 'true'
}

export async function getStoredRegistrationMode(): Promise<RegistrationMode> {
  const setting = await prisma.siteSetting.findUnique({
    where: { key: registrationModeSettingKey },
    select: { value: true },
  })
  return isValidRegistrationMode(setting?.value) ? setting.value : 'EMAIL'
}

export async function setStoredRegistrationMode(mode: RegistrationMode) {
  await prisma.siteSetting.upsert({
    where: { key: registrationModeSettingKey },
    update: {
      value: mode,
      valueType: 'TEXT',
      group: 'system',
      label: '注册模式',
    },
    create: {
      key: registrationModeSettingKey,
      value: mode,
      valueType: 'TEXT',
      group: 'system',
      label: '注册模式',
    },
  })
}

export async function getRegistrationLimitEnabled() {
  const setting = await prisma.siteSetting.findUnique({
    where: { key: registrationLimitSettingKey },
    select: { value: true },
  })
  return setting?.value === 'true'
}

export async function setRegistrationLimitEnabled(enabled: boolean) {
  await prisma.siteSetting.upsert({
    where: { key: registrationLimitSettingKey },
    update: {
      value: String(enabled),
      valueType: 'BOOLEAN',
      group: 'system',
      label: '注册限制',
    },
    create: {
      key: registrationLimitSettingKey,
      value: String(enabled),
      valueType: 'BOOLEAN',
      group: 'system',
      label: '注册限制',
    },
  })
}

function parseStoredDate(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseStoredDailySchedule(value: string | undefined) {
  if (!value) return []
  try {
    return parseRegistrationDailyScheduleInput(JSON.parse(value)) || []
  } catch {
    return []
  }
}

export async function getRegistrationControlSettings(): Promise<RegistrationControlSettings> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.values(registrationControlSettingDefinitions).map((item) => item.key) } },
    select: { key: true, value: true },
  })
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const modeValue = values.get(registrationControlSettingDefinitions.mode.key)
  const overrideValue = values.get(registrationControlSettingDefinitions.override.key)
  return {
    mode: normalizeRegistrationControlMode(modeValue) || 'MANUAL',
    dailySchedule: parseStoredDailySchedule(values.get(registrationControlSettingDefinitions.dailySchedule.key)),
    opensAt: parseStoredDate(values.get(registrationControlSettingDefinitions.opensAt.key)),
    closesAt: parseStoredDate(values.get(registrationControlSettingDefinitions.closesAt.key)),
    override: isValidRegistrationControlOverride(overrideValue) ? overrideValue : 'NONE',
    closedTitle: values.get(registrationControlSettingDefinitions.closedTitle.key) || undefined,
    closedMessage: values.get(registrationControlSettingDefinitions.closedMessage.key) || undefined,
  }
}

export async function setRegistrationControlSettings(
  settings: RegistrationControlSettings,
  database: Pick<Prisma.TransactionClient, 'siteSetting'> = prisma,
) {
  const values = {
    mode: normalizeRegistrationControlMode(settings.mode) || 'MANUAL',
    dailySchedule: JSON.stringify(settings.dailySchedule || []),
    opensAt: settings.opensAt?.toISOString() || '',
    closesAt: settings.closesAt?.toISOString() || '',
    override: settings.override,
    closedTitle: settings.closedTitle || '当前暂停注册',
    closedMessage: settings.closedMessage || '注册入口目前暂时关闭，请稍后再来。',
  }
  // Keep writes ordered inside the interactive transaction. This makes the
  // settings and the accompanying admin audit entry one atomic update while
  // avoiding concurrent queries on the same transaction connection.
  for (const [name, definition] of Object.entries(registrationControlSettingDefinitions)) {
    await database.siteSetting.upsert({
      where: { key: definition.key },
      update: { value: values[name as keyof typeof values], valueType: 'TEXT', group: 'system', label: definition.label },
      create: { key: definition.key, value: values[name as keyof typeof values], valueType: 'TEXT', group: 'system', label: definition.label },
    })
  }
}

/**
 * The single server-side source of truth for the current registration window.
 * Callers may pass the already-loaded settings from getRegistrationPolicy so
 * the policy path does not issue a second configuration query.
 */
export async function getRegistrationAvailability(input: {
  baseRegistrationOpen: boolean
  settings?: RegistrationControlSettings
  now?: Date
}): Promise<RegistrationAvailability> {
  const settings = input.settings || await getRegistrationControlSettings()
  return resolveRegistrationAvailability({ settings, baseRegistrationOpen: input.baseRegistrationOpen, now: input.now })
}

export async function getRegistrationPolicy() {
  const allowRegister = isRegisterEnvAllowed()
  const enableTurnstile = isTurnstileEnabled()
  const [registrationMode, registrationControl, securitySettings, hospitalConfig, registrationLimitEnabled] = await Promise.all([
    getStoredRegistrationMode(),
    getRegistrationControlSettings(),
    getAccountSecuritySettings(),
    getEHospitalCheckConfig(),
    getRegistrationLimitEnabled(),
  ])
  const allowPhoneRegistration = allowRegister && (registrationMode === 'PHONE' || registrationMode === 'BOTH')
  const legacyEmailRegistrationEnabled = registrationMode === 'EMAIL' || registrationMode === 'BOTH'
  // The emergency OPEN action is allowed to recover from the legacy CLOSED
  // switch without rewriting the legacy registration-channel setting.
  const allowEmailRegistration = allowRegister && (legacyEmailRegistrationEnabled || (registrationMode === 'CLOSED' && registrationControl.override === 'OPEN'))
  const baseRegistrationOpen = allowEmailRegistration
  const registrationAvailability = await getRegistrationAvailability({ settings: registrationControl, baseRegistrationOpen })
  const registrationClosed = !registrationAvailability.isOpen

  return {
    allowRegister,
    registrationMode,
    registrationModeLabel: registrationModeLabels[registrationMode],
    allowPhoneRegistration,
    allowEmailRegistration,
    registrationClosed,
    registrationControl,
    registrationAvailability,
    enableTurnstile,
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '',
    envForcedClosed: !allowRegister,
    requireSecurityQuestionsForNewUsers: securitySettings.requireSecurityQuestionsForNewUsers,
    ehospitalCheckEnabled: hospitalConfig.enabled,
    registrationLimitEnabled,
  }
}

export async function isRegistrationAllowed(type: RegistrationType) {
  const policy = await getRegistrationPolicy()
  if (policy.registrationClosed) return false
  return type === 'PHONE' ? policy.allowPhoneRegistration : policy.allowEmailRegistration
}

export async function isPhoneRegistrationAllowed() {
  return isRegistrationAllowed('PHONE')
}

export async function isEmailRegistrationAllowed() {
  return isRegistrationAllowed('EMAIL')
}
