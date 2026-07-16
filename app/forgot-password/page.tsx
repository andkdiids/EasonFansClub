import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getSiteAppearance } from '@/lib/site-config'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage() {
  const [appearance, settings] = await Promise.all([getSiteAppearance(), getAccountSecuritySettings()])
  return <AuthFormShell title="忘记密码" subtitle="验证账号后设置新密码" siteName={appearance.text.siteName} backgroundUrl={appearance.images.loginBackgroundUrl} footer={<Link href="/login" className="font-black text-brand-700">返回登录</Link>}>
    <ForgotPasswordForm emailEnabled={settings.enableEmailPasswordReset} securityEnabled={settings.enableSecurityQuestionRecovery} />
  </AuthFormShell>
}
