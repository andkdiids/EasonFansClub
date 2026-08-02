import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getEHospitalCheckConfig } from '@/lib/ehospital-check'
import { EHospitalCheckSettingsForm } from './EHospitalCheckSettingsForm'

export const dynamic = 'force-dynamic'

export default async function EHospitalAdminPage() {
  const user = await requireAdminPage('/admin/ehospital', 'account_security_manage')
  const config = await getEHospitalCheckConfig()
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-brand-600">系统设置 / 入院管理</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">E院体检</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-600">管理新用户音乐听力验证的开关、题量、单题试听时长、通过分数和每日次数。</p>
        </div>
        <EHospitalCheckSettingsForm initial={config} />
      </main>
    </>
  )
}
