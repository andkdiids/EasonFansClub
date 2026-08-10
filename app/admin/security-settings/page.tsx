import { requireAdminPage } from '@/components/AdminAccess'

import { getAccountSecuritySettings } from '@/lib/account-security'
import { getRegistrationPolicy } from '@/lib/registration'
import { RegistrationSettingsForm } from '../settings/RegistrationSettingsForm'
import { SecuritySettingsForm } from './SecuritySettingsForm'

export const dynamic = 'force-dynamic'

export default async function AdminSecuritySettingsPage() {
  await requireAdminPage('/admin/security-settings', 'account_security_manage')
  const [settings, policy] = await Promise.all([getAccountSecuritySettings(), getRegistrationPolicy()])
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
      <header>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-brand-700">系统设置 / 入院管理</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">入院管理</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">统一配置注册流程、验证方式、密保与邮箱密码找回策略；修改会记录管理员操作日志。</p>
      </header>
      <section id="registration-settings" className="scroll-mt-24">
        <RegistrationSettingsForm initialPolicy={{ allowRegister: policy.allowRegister, registrationMode: policy.registrationMode, registrationModeLabel: policy.registrationModeLabel, allowPhoneRegistration: policy.allowPhoneRegistration, allowEmailRegistration: policy.allowEmailRegistration, registrationClosed: policy.registrationClosed, enableTurnstile: policy.enableTurnstile, envForcedClosed: policy.envForcedClosed, registrationLimitEnabled: policy.registrationLimitEnabled }} />
      </section>
      <section id="verification-settings" className="scroll-mt-24 rounded-2xl border border-sky-100 bg-sky-50/60 p-5">
        <h2 className="text-xl font-black text-brand-950">验证设置</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">邮箱、手机和密保验证策略与注册流程设置联动，具体开关见上方注册设置和下方账户安全设置。</p>
      </section>
      <section id="security-settings" className="scroll-mt-24">
        <SecuritySettingsForm initial={settings} />
      </section>
    </main>
  )
}
