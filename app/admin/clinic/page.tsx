import { requireAdminPage } from '@/components/AdminAccess'
import { ClinicAdminPanel } from '@/components/clinic/ClinicAdminPanel'
import { UiIcon } from '@/components/UiIcon'

export const dynamic = 'force-dynamic'

export default async function ClinicAdminPage() {
  await requireAdminPage('/admin/clinic', 'clinic_manage')

  return (
    <main className="clinic-page-shell clinic-admin-page">
      <div className="clinic-detail-top">
        <a href="/admin">← 返回管理后台</a>
        <span className="clinic-kicker">CONTENT MANAGEMENT</span>
      </div>
      <section className="clinic-hero">
        <div>
          <p className="clinic-kicker">阿士匹灵门诊部 · 内容管理</p>
          <h1>门诊审核台</h1>
          <p>这里可以查看前台展示身份与真实用户身份，处理病历、会诊和举报。真实 UID 只在本权限页面返回。</p>
        </div>
        <div className="clinic-hero-mark" aria-hidden="true"><UiIcon name="stethoscope" /></div>
      </section>
      <ClinicAdminPanel />
    </main>
  )
}
