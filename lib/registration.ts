import { prisma } from '@/lib/prisma'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getEHospitalCheckConfig } from '@/lib/ehospital-check'

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

export async function getRegistrationPolicy() {
  const allowRegister = isRegisterEnvAllowed()
  const registrationMode = await getStoredRegistrationMode()
  const enableTurnstile = isTurnstileEnabled()
  const [securitySettings, hospitalConfig] = await Promise.all([getAccountSecuritySettings(), getEHospitalCheckConfig()])
  const allowPhoneRegistration = allowRegister && (registrationMode === 'PHONE' || registrationMode === 'BOTH')
  const allowEmailRegistration = allowRegister && (registrationMode === 'EMAIL' || registrationMode === 'BOTH')
  const registrationClosed = !allowRegister || registrationMode === 'CLOSED' || (!allowPhoneRegistration && !allowEmailRegistration)

  return {
    allowRegister,
    registrationMode,
    registrationModeLabel: registrationModeLabels[registrationMode],
    allowPhoneRegistration,
    allowEmailRegistration,
    registrationClosed,
    enableTurnstile,
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '',
    envForcedClosed: !allowRegister,
    requireSecurityQuestionsForNewUsers: securitySettings.requireSecurityQuestionsForNewUsers,
    ehospitalCheckEnabled: hospitalConfig.enabled,
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
