import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getSiteAppearance } from '@/lib/site-config'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const params = await searchParams
  const config = await getSiteAppearance()

  return (
    <AuthFormShell
      title="登录账号"
      subtitle={config.text.loginHint}
      siteName={config.text.siteName}
      backgroundUrl={config.images.loginBackgroundUrl}
      footer={
        <>
          还没有账号？{' '}
          <Link href="/register" className="font-black text-brand-700">
            去注册
          </Link>
        </>
      }
    >
      <LoginForm redirectTo={params.redirect} />
    </AuthFormShell>
  )
}
