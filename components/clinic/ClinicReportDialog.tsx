'use client'

import { useState } from 'react'
import { clinicReportReasons } from '@/lib/clinic-config'

type Target = { recordId: string } | { consultationId: string }

export function ClinicReportDialog({ target, onClose }: Readonly<{ target: Target; onClose: () => void }>) {
  const [reason, setReason] = useState<string>(clinicReportReasons[0])
  const [detail, setDetail] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/clinic/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, reason, detail }),
      })
      const body = await response.json().catch(() => null) as { message?: string }
      if (!response.ok) throw new Error(body?.message || '举报提交失败，请稍后再试。')
      onClose()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '举报提交失败，请稍后再试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="clinic-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="clinic-dialog" role="dialog" aria-modal="true" aria-labelledby="clinic-report-title">
        <header><div><p className="clinic-kicker">REPORT</p><h2 id="clinic-report-title">举报这条内容</h2></div><button type="button" aria-label="关闭举报窗口" onClick={onClose}>×</button></header>
        <label className="clinic-field"><span>举报原因</span><select value={reason} onChange={(event) => setReason(event.target.value)}>{clinicReportReasons.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="clinic-field"><span>补充说明（可选）</span><textarea value={detail} maxLength={500} onChange={(event) => setDetail(event.target.value)} placeholder="告诉管理员更多情况" /></label>
        {error ? <p className="clinic-form-error" role="alert">{error}</p> : null}
        <footer className="clinic-dialog-actions"><button type="button" className="clinic-secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="clinic-primary-button" disabled={saving} onClick={() => void submit()}>{saving ? '提交中…' : '提交举报'}</button></footer>
      </section>
    </div>
  )
}
