import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getSiteAppearance } from '@/lib/site-config'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RegisterPage() {
  const config = await getSiteAppearance()

  return (
    <AuthFormShell
      title="创建账号"
      subtitle={config.text.registerHint}
      siteName={config.text.siteName}
      backgroundUrl={config.images.registerBackgroundUrl}
      footer={
        <>
          已经有账号？{' '}
          <Link href="/login" className="font-black text-brand-700">
            去登录
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthFormShell>
  )
}
