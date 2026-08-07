import { requireAdminPage } from '@/components/AdminAccess'

import { getAccountSecuritySettings } from '@/lib/account-security'
import { getRegistrationPolicy } from '@/lib/registration'
import { RegistrationSettingsForm } from '../settings/RegistrationSettingsForm'
import { SecuritySettingsForm } from './SecuritySettingsForm'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminSecuritySettingsPage() {
  const user = await requireAdminPage('/admin/security-settings', 'account_security_manage')
  const [settings, policy] = await Promise.all([getAccountSecuritySettings(), getRegistrationPolicy()])
  return <><main className="mx-auto max-w-4xl space-y-6 px-5 py-8"><div><h1 className="text-3xl font-black text-brand-950">账户安全设置</h1><p className="mt-3 text-sm font-bold text-slate-600">统一配置注册、密保、邮箱、手机与密码找回策略；修改会记录管理员操作日志。</p><Link href="/admin/ehospital" className="mt-4 inline-flex rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">进入入院管理 · E院体检</Link></div><SecuritySettingsForm initial={settings} /><RegistrationSettingsForm initialPolicy={{ allowRegister: policy.allowRegister, registrationMode: policy.registrationMode, registrationModeLabel: policy.registrationModeLabel, allowPhoneRegistration: policy.allowPhoneRegistration, allowEmailRegistration: policy.allowEmailRegistration, registrationClosed: policy.registrationClosed, enableTurnstile: policy.enableTurnstile, envForcedClosed: policy.envForcedClosed }} /></main></>
}
