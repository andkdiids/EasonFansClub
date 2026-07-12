import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const params = await searchParams

  return (
    <AuthFormShell
      title="登录账号"
      subtitle="回到私家E院，继续查看帖子、挂号和参与应援计划。"
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
