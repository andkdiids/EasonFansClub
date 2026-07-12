import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function RegisterPage() {
  return (
    <AuthFormShell
      title="创建账号"
      subtitle="加入私家E院，开始发帖、回复、签到和积累应援积分。"
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
