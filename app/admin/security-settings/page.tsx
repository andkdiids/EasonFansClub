import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getRegistrationPolicy } from '@/lib/registration'
import { RegistrationSettingsForm } from '../settings/RegistrationSettingsForm'
import { SecuritySettingsForm } from './SecuritySettingsForm'

export const dynamic = 'force-dynamic'

export default async function AdminSecuritySettingsPage() {
  const user = await requireAdminPage('/admin/security-settings', 'account_security_manage')
  const [settings, policy] = await Promise.all([getAccountSecuritySettings(), getRegistrationPolicy()])
  return <><SiteHeader user={user} /><main className="mx-auto max-w-4xl space-y-6 px-5 py-8"><div><h1 className="text-3xl font-black text-brand-950">账户安全设置</h1><p className="mt-3 text-sm font-bold text-slate-600">统一配置注册、密保、邮箱、手机与密码找回策略；修改会记录管理员操作日志。</p></div><SecuritySettingsForm initial={settings} /><RegistrationSettingsForm initialPolicy={{ allowRegister: policy.allowRegister, registrationMode: policy.registrationMode, registrationModeLabel: policy.registrationModeLabel, allowPhoneRegistration: policy.allowPhoneRegistration, allowEmailRegistration: policy.allowEmailRegistration, registrationClosed: policy.registrationClosed, enableTurnstile: policy.enableTurnstile, envForcedClosed: policy.envForcedClosed }} /></main></>
}
