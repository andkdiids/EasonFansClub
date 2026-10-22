import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage() {
  const appearance = await getSiteAppearance()
  return <AuthFormShell title="重置密码" subtitle="设置新的登录密码" siteName={appearance.text.siteName} backgroundUrl={appearance.images.loginBackgroundUrl} logoUrl={appearance.images.navLogoUrl || appearance.images.logoUrl} footer={<Link href="/login" className="font-black text-brand-700">返回登录</Link>}>
    <div className="space-y-4 text-center">
      <p className="rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold leading-7 text-amber-800">邮箱密码重置暂未开放。请使用密保问题找回密码，或联系管理员协助恢复账号。</p>
      <Link href="/forgot-password" className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">前往密保找回</Link>
    </div>
  </AuthFormShell>
}
