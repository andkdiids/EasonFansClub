import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { getClinicMe } from '@/lib/clinic-service'

export const dynamic = 'force-dynamic'

export default async function ClinicMePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fclinic%2Fme')
  const data = await getClinicMe(user.id)
  return (
    <main className="clinic-page-shell clinic-me-page">
      <div className="clinic-detail-back"><Link href="/clinic">← 返回门诊部</Link></div>
      <header className="clinic-form-heading"><p className="clinic-kicker">MY CLINIC</p><h1>我的门诊记录</h1><p>你在这里留下的病历和会诊。</p></header>
      <section className="clinic-me-section"><h2>我发布的病历</h2>{data.records.length ? <div className="clinic-record-list">{data.records.map((record) => <article key={record.id} className="clinic-me-row"><div><span className="clinic-category-label">{record.categoryLabel}</span><p>{record.content}</p></div><Link href={`/clinic/${record.id}`}>查看 →</Link></article>)}</div> : <p className="clinic-empty-consultation">你还没有挂号记录。</p>}</section>
      <section className="clinic-me-section"><h2>我的会诊</h2>{data.consultations.length ? <div className="clinic-me-list">{data.consultations.map((item) => <article key={item.id} className="clinic-me-row"><div><span className="clinic-category-label">{item.categoryLabel}</span><p>{item.content}</p><small>{item.recordPreview}</small></div><Link href={`/clinic/${item.recordId}#clinic-consultation-${item.id}`}>查看 →</Link></article>)}</div> : <p className="clinic-empty-consultation">你还没有参与会诊。</p>}</section>
      <footer className="clinic-disclaimer">阿士匹灵门诊部是病友交流与情绪树洞，不提供专业医疗或心理诊断。如遇真实身体或心理健康问题，请及时寻求专业帮助。</footer>
    </main>
  )
}
