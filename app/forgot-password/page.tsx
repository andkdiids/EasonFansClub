import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getSiteAppearance } from '@/lib/site-config'
import { EmailPasswordLinkForm } from './EmailPasswordLinkForm'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage() {
  const [appearance, settings] = await Promise.all([getSiteAppearance(), getAccountSecuritySettings()])
  return <AuthFormShell title="忘记密码" subtitle="验证账号后设置新密码" siteName={appearance.text.siteName} backgroundUrl={appearance.images.loginBackgroundUrl} logoUrl={appearance.images.navLogoUrl || appearance.images.logoUrl} footer={<Link href="/login" className="font-black text-brand-700">返回登录</Link>}>
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-black text-brand-950">邮箱链接找回</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-slate-500">输入注册邮箱，我们会发送一次性密码重置链接。</p>
        </div>
        <EmailPasswordLinkForm />
      </section>
      <section className="space-y-3 border-t border-sky-100 pt-5">
        <div>
          <h2 className="text-lg font-black text-brand-950">其他找回方式</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-slate-500">密保问题和原有邮箱验证码找回仍可继续使用。</p>
        </div>
        <ForgotPasswordForm emailEnabled={settings.enableEmailPasswordReset} securityEnabled={settings.enableSecurityQuestionRecovery} />
      </section>
    </div>
  </AuthFormShell>
}
