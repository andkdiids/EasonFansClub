import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { IcpRecord } from '@/components/IcpRecord'
import { getSiteAppearance } from '@/lib/site-config'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; redirect?: string; account?: string }> }) {
  const params = await searchParams
  const config = await getSiteAppearance()

  return (
    <AuthFormShell
      title="登录账号"
      subtitle={config.text.loginHint}
      siteName={config.text.siteName}
      backgroundUrl={config.images.loginBackgroundUrl}
      heroVisual={config.heroVisuals.login}
      logoUrl={config.images.navLogoUrl || config.images.logoUrl}
      footer={
  <div className="space-y-3 text-center">
    <div>
      还没有账号？{' '}
      <Link href="/register" className="font-black text-brand-700">
        去注册
      </Link>
    </div>

    <IcpRecord inverse />
  </div>
}
    >
      <LoginForm redirectTo={params.next || params.redirect} initialAccount={params.account} />
    </AuthFormShell>
  )
}
