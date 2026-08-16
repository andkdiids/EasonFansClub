import Link from 'next/link'
import { getClinicDailyReport } from '@/lib/clinic-service'

export const dynamic = 'force-dynamic'

export default async function ClinicDailyReportPage() {
  const report = await getClinicDailyReport()
  return (
    <main className="clinic-page-shell clinic-report-page">
      <div className="clinic-detail-back"><Link href="/clinic">← 返回门诊部</Link></div>
      <header className="clinic-form-heading"><h1>{report.dateLabel} · 门诊日报</h1><p>今天的病友，辛苦了。</p></header>
      <section className="clinic-report-panel"><p className="clinic-report-lead">今日共有 <strong>{report.patientCount}</strong> 位患者挂号，留下 <strong>{report.recordCount}</strong> 份有效病历。</p><div className="clinic-report-stats"><div><strong>{report.aspirinCount.toLocaleString('zh-CN')}</strong><span>病友送出的阿士匹灵</span></div><div><strong>{report.consultationCount.toLocaleString('zh-CN')}</strong><span>次会诊</span></div><div><strong>{report.mouthpieceCount.toLocaleString('zh-CN')}</strong><span>次嘴替</span></div></div><div className="clinic-report-categories">{report.categories.map((item) => <div key={item.category}><span>{item.label}</span><b>{item.count} 条</b></div>)}</div>{report.topCategory ? <p className="clinic-report-top">今日最多症状：<strong>{report.topCategory.label}</strong></p> : null}<p className="clinic-report-closing">{report.closing}</p></section>
      <footer className="clinic-disclaimer">阿士匹灵门诊部是病友交流与情绪树洞，不提供专业医疗或心理诊断。如遇真实身体或心理健康问题，请及时寻求专业帮助。</footer>
    </main>
  )
}
