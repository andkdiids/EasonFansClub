import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getSiteAppearance } from '@/lib/site-config'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string; account?: string }> }) {
  const params = await searchParams
  const config = await getSiteAppearance()

  return (
    <AuthFormShell
      title="登录账号"
      subtitle={config.text.loginHint}
      siteName={config.text.siteName}
      backgroundUrl={config.images.loginBackgroundUrl}
      footer={
  <div className="space-y-3 text-center">
    <div>
      还没有账号？{' '}
      <Link href="/register" className="font-black text-brand-700">
        去注册
      </Link>
    </div>

    <a
      href="https://beian.miit.gov.cn"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block text-xs text-white/70 transition-colors hover:text-white"
    >
      ICP备案号：粤ICP备2026099247号-1
    </a>
  </div>
}
    >
      <LoginForm redirectTo={params.redirect} initialAccount={params.account} />
    </AuthFormShell>
  )
}
