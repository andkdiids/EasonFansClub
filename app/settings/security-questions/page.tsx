import { redirect } from 'next/navigation'
import { SecurityQuestionsForm } from '@/components/SecurityQuestionsForm'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function SecurityQuestionsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fsettings%2Fsecurity-questions')
  const count = await prisma.userSecurityQuestion.count({ where: { userId: user.id } })
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-3xl font-black text-brand-950">设置密保问题</h1>
        <p className="mt-3 mb-6 text-sm font-bold leading-7 text-slate-600">答案会规范化后使用与密码同等级的哈希保存。密保问题设置后不可修改。</p>
        {count >= 1 ? <p className="rounded-2xl bg-emerald-50 px-5 py-4 font-black text-emerald-700">已设置，不可修改。</p> : <SecurityQuestionsForm />}
      </main>
    </>
  )
}
