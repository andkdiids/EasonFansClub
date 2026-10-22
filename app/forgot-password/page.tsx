import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getSiteAppearance } from '@/lib/site-config'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage() {
  const [appearance, settings] = await Promise.all([getSiteAppearance(), getAccountSecuritySettings()])
  return <AuthFormShell title="忘记密码" subtitle="验证账号后设置新密码" siteName={appearance.text.siteName} backgroundUrl={appearance.images.loginBackgroundUrl} logoUrl={appearance.images.navLogoUrl || appearance.images.logoUrl} footer={<Link href="/login" className="font-black text-brand-700">返回登录</Link>}>
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-black text-brand-950">密保问题找回</h2>
        <p className="mt-1 text-sm font-bold leading-6 text-slate-500">使用设置账号时保存的密保答案验证身份。为保护账号隐私，系统不会在此显示已保存的答案或提示具体问题。</p>
      </div>
      <ForgotPasswordForm securityEnabled={settings.enableSecurityQuestionRecovery} />
    </section>
  </AuthFormShell>
}
