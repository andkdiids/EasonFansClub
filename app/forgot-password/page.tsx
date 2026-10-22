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
        <h2 className="text-lg font-black text-white">密保问题找回</h2>
        <p className="mt-1 text-sm font-bold leading-6 text-slate-200">使用设置账号时保存的密保答案验证身份。为保护账号隐私，页面仅显示部分密保问题，不会显示答案。</p>
      </div>
      <ForgotPasswordForm securityEnabled={settings.enableSecurityQuestionRecovery} />
    </section>
  </AuthFormShell>
}
