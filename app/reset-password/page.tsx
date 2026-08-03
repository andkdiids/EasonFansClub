import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getSiteAppearance } from '@/lib/site-config'
import { ResetPasswordForm } from './ResetPasswordForm'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const [appearance, params] = await Promise.all([getSiteAppearance(), searchParams])
  const token = Array.isArray(params.token) ? params.token[0] || '' : params.token || ''
  return <AuthFormShell title="重置密码" subtitle="设置新的登录密码" siteName={appearance.text.siteName} backgroundUrl={appearance.images.loginBackgroundUrl} logoUrl={appearance.images.navLogoUrl || appearance.images.logoUrl} footer={<Link href="/login" className="font-black text-brand-700">返回登录</Link>}>
    <ResetPasswordForm token={token} />
  </AuthFormShell>
}
