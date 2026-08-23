import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { AdminCheckInMakeup } from './AdminCheckInMakeup'

export default async function AdminCheckInMakeupPage() {
  await requireAdminPage('/admin/checkin-makeup', 'checkin_manage')
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
      <section className="border border-sky-100 bg-white p-6">
        <p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">手动补签</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">用于系统异常、客服补偿和数据修复。管理员补签免费，不占用户周额度或月度挑战。</p>
        <Link href="/admin" className="mt-5 inline-flex min-h-11 items-center bg-brand-950 px-5 text-sm font-black text-white">返回后台</Link>
      </section>
      <AdminCheckInMakeup />
    </main>
  )
}
