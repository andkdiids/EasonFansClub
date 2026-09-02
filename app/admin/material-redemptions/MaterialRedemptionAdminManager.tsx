'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MaterialRedemptionScanner } from '@/components/MaterialRedemptionScanner'
import { normalizeMaterialRedeemCodeInput, parseMaterialRedeemCode, parseMaterialRedemptionQr } from '@/lib/material-redemption-domain'

type Rule = { type: string; operator: string; value: string }
type Material = {
  id: string
  title: string
  description: string
  coverImageUrl: string | null
  instructions: string | null
  cost: number
  stockTotal: number
  stockRemaining: number
  exchangedQuantity?: number
  redeemedQuantity?: number
  perUserLimit: number
  exchangeStartAt: string
  exchangeEndAt: string
  redeemEndAt: string
  status: string
  stateLabel: string
  redemptionRule: 'DEFAULT' | 'ACTIVITY_REGISTRATION_REQUIRED'
  linkedActivityId: string | null
  linkedActivity: { id: string; title: string } | null
  rules: Rule[]
}
type Order = { id: string; material: { title: string }; user: { uid: number; nickname: string }; quantity: number; totalCost: number; status: string; statusLabel: string; source: 'MANUAL' | 'ACTIVITY_REGISTRATION_AUTO'; sourceLabel: string; linkedActivity: { id: string; title: string } | null; redemptionSourceLabel: string | null; linkedRegistration: { id: string; status: string; checkInSource: string | null } | null; redeemCode: string; createdAt: string; redeemedAt: string | null; redeemedByAdmin: { uid: number; nickname: string } | null }
type Option = { id: string; label: string }

const emptyForm = { title: '', description: '', coverImageUrl: '', instructions: '', cost: 0, stockTotal: 0, perUserLimit: 1, exchangeStartAt: '', exchangeEndAt: '', redeemEndAt: '', status: 'DRAFT', redemptionRule: 'DEFAULT', linkedActivityId: '', rules: [{ type: 'NONE', operator: 'EQ', value: '' }] }
const ruleLabels: Record<string, string> = { NONE: '无门槛', ACTIVITY_REGISTRATION_REQUIRED: '需报名指定活动', REGISTER_DAYS: '注册满指定天数', CHECKIN_TOTAL: '累计挂号天数', CHECKIN_STREAK: '连续挂号天数', HAS_BADGE: '拥有指定勋章', ATTENDED_CONCERT: '记录过指定演唱会', SPECIFIC_USER: '指定用户' }
const numericRules = new Set(['REGISTER_DAYS', 'CHECKIN_TOTAL', 'CHECKIN_STREAK'])
const optionKinds: Record<string, string> = { ACTIVITY_REGISTRATION_REQUIRED: 'activities', HAS_BADGE: 'badges', ATTENDED_CONCERT: 'concerts', SPECIFIC_USER: 'users' }

function toDateTimeLocal(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`
}

function toShanghaiIso(value: string) {
  return value ? `${value}:00+08:00` : value
}

function formFromMaterial(material: Material) {
  return { title: material.title, description: material.description, coverImageUrl: material.coverImageUrl || '', instructions: material.instructions || '', cost: material.cost, stockTotal: material.stockTotal, perUserLimit: material.perUserLimit, exchangeStartAt: toDateTimeLocal(material.exchangeStartAt), exchangeEndAt: toDateTimeLocal(material.exchangeEndAt), redeemEndAt: toDateTimeLocal(material.redeemEndAt), status: material.status, redemptionRule: material.redemptionRule, linkedActivityId: material.linkedActivityId || '', rules: material.rules.length ? material.rules.map((rule) => ({ type: rule.type, operator: rule.operator, value: rule.value })) : emptyForm.rules }
}

function verifyCodeInputValue(value: string) {
  const normalized = normalizeMaterialRedeemCodeInput(value)
  return parseMaterialRedeemCode(normalized)?.suffix || normalized
}

export function MaterialRedemptionAdminManager({ initialTab = 'materials', initialVerifyToken = '' }: { initialTab?: 'materials' | 'orders' | 'verify'; initialVerifyToken?: string } = {}) {
  const [tab, setTab] = useState<'materials' | 'orders' | 'verify'>(initialTab)
  const [materials, setMaterials] = useState<Material[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [orderStatus, setOrderStatus] = useState('')
  const [query, setQuery] = useState('')
  const [verifyToken, setVerifyToken] = useState(initialVerifyToken)
  const [verifyCodeInput, setVerifyCodeInput] = useState(() => verifyCodeInputValue(initialVerifyToken))
  const [scannerOpen, setScannerOpen] = useState(false)
  const [redeemSuccess, setRedeemSuccess] = useState(false)
  const [verifyPreview, setVerifyPreview] = useState<{ id: string; material: { title: string; coverImageUrl: string | null; redeemEndAt: string }; user: { uid: number; nickname: string }; quantity: number; totalCost: number; status: string; statusLabel: string; redeemCode: string; canRedeem: boolean; activityCancelled?: boolean; expired: boolean; notStarted: boolean; createdAt: string; redeemedAt: string | null; redeemedByAdmin: { uid: number; nickname: string } | null } | null>(null)
  const [options, setOptions] = useState<Record<string, Option[]>>({})
  const [ruleSearch, setRuleSearch] = useState<Record<number, string>>({})
  const [ruleSearchIndex, setRuleSearchIndex] = useState(0)

  async function loadMaterials() {
    const response = await fetch('/api/admin/material-redemptions', { cache: 'no-store' })
    const data = await response.json() as { materials?: Material[]; message?: string }
    if (!response.ok) throw new Error(data.message || '物料加载失败')
    setMaterials(data.materials || [])
  }

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams()
    if (orderStatus) params.set('status', orderStatus)
    if (query.trim()) params.set('q', query.trim())
    const response = await fetch(`/api/admin/material-redemptions/orders?${params}`, { cache: 'no-store' })
    const data = await response.json() as { orders?: Order[]; message?: string }
    if (!response.ok) throw new Error(data.message || '订单加载失败')
    setOrders(data.orders || [])
  }, [orderStatus, query])

  useEffect(() => { void loadMaterials().catch((error) => setMessage(error instanceof Error ? error.message : '物料加载失败')) }, [])
  useEffect(() => { if (tab === 'orders') void loadOrders().catch((error) => setMessage(error instanceof Error ? error.message : '订单加载失败')) }, [tab, loadOrders])

  const selected = useMemo(() => materials.find((material) => material.id === editing) || null, [editing, materials])

  function startCreate() { setEditing(null); setForm({ ...emptyForm, rules: [{ type: 'NONE', operator: 'EQ', value: '' }] }); setMessage('') }
  function startEdit(material: Material) { setEditing(material.id); setForm(formFromMaterial(material)); setRuleSearch({}); setMessage(''); material.rules.forEach((rule) => { if (optionKinds[rule.type]) void loadRuleOptions(rule.type) }) }
  function updateForm(key: string, value: unknown) { setForm((current) => ({ ...current, [key]: value })) }
  function updateRule(index: number, key: keyof Rule, value: string) { setForm((current) => ({ ...current, rules: current.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, [key]: value, ...(key === 'type' && value === 'NONE' ? { operator: 'EQ', value: '' } : key === 'type' && !numericRules.has(value) ? { operator: 'EQ' } : {}) } : rule) })) }

  async function loadRuleOptions(type: string, q = '') {
    const kind = optionKinds[type]
    if (!kind) return
    const response = await fetch(`/api/admin/material-redemptions/options?kind=${kind}&q=${encodeURIComponent(q)}`, { cache: 'no-store' })
    const data = await response.json() as { options?: Option[] }
    setOptions((current) => ({ ...current, [type]: data.options || [] }))
  }

  async function uploadCover(file: File) {
    setBusy(true); setMessage('')
    try {
      const body = new FormData(); body.append('file', file)
      const response = await fetch('/api/admin/material-redemptions/upload', { method: 'POST', body })
      const data = await response.json() as { url?: string; message?: string }
      if (!response.ok || !data.url) throw new Error(data.message || '图片上传失败')
      updateForm('coverImageUrl', data.url)
      setMessage('封面上传成功')
    } catch (error) { setMessage(error instanceof Error ? error.message : '图片上传失败') } finally { setBusy(false) }
  }

  async function saveMaterial() {
    setBusy(true); setMessage('')
    try {
      const payload = { ...form, linkedActivityId: form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED' ? form.linkedActivityId : '', cost: Number(form.cost), stockTotal: Number(form.stockTotal), perUserLimit: Number(form.perUserLimit), exchangeStartAt: toShanghaiIso(form.exchangeStartAt), exchangeEndAt: toShanghaiIso(form.exchangeEndAt), redeemEndAt: toShanghaiIso(form.redeemEndAt) }
      const response = await fetch(editing ? `/api/admin/material-redemptions/${editing}` : '/api/admin/material-redemptions', { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json() as { material?: Material; message?: string }
      if (!response.ok || !data.material) throw new Error(data.message || '保存失败')
      setMessage(editing ? '物料已更新' : '物料已创建')
      await loadMaterials()
      if (!editing) setEditing(data.material.id)
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') } finally { setBusy(false) }
  }

  async function adjustStock(material: Material, delta: number) {
    const reason = window.prompt('请填写库存调整原因')
    if (!reason) return
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/material-redemptions/${material.id}/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta, reason }) })
      const data = await response.json() as { message?: string }
      if (!response.ok) throw new Error(data.message || '库存调整失败')
      setMessage('库存已调整'); await loadMaterials()
    } catch (error) { setMessage(error instanceof Error ? error.message : '库存调整失败') } finally { setBusy(false) }
  }

  async function previewVerify(lookup = verifyToken) {
    const normalizedLookup = lookup.trim()
    setMessage(''); setRedeemSuccess(false); setVerifyPreview(null)
    if (!normalizedLookup) {
      setMessage('请输入兑换码，或先扫描兑换二维码')
      return
    }
    try {
      setVerifyToken(normalizedLookup)
      const response = await fetch(`/api/admin/material-redemptions/verify?token=${encodeURIComponent(normalizedLookup)}`, { cache: 'no-store' })
      const data = await response.json() as { order?: typeof verifyPreview; message?: string }
      if (!response.ok || !data.order) throw new Error(data.message || '订单不存在')
      setVerifyPreview(data.order)
    } catch (error) { setMessage(error instanceof Error ? error.message : '订单预览失败') }
  }

  function handleVerifyCodeInput(value: string) {
    const normalized = normalizeMaterialRedeemCodeInput(value)
    const parsed = parseMaterialRedeemCode(normalized)
    setVerifyCodeInput(parsed?.suffix || normalized)
    setVerifyToken(parsed?.input || normalized)
  }

  function openScanner() {
    setMessage('')
    setRedeemSuccess(false)
    setVerifyPreview(null)
    setScannerOpen(true)
  }

  function handleScannedIdentifier(identifier: string) {
    setRedeemSuccess(false)
    const parsed = parseMaterialRedemptionQr(identifier)
    setVerifyCodeInput(parsed?.redeemCode ? parseMaterialRedeemCode(parsed.redeemCode)?.suffix || '' : '')
    setVerifyToken(identifier)
    void previewVerify(identifier)
  }

  async function confirmVerify() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/admin/material-redemptions/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verifyToken }) })
      const data = await response.json() as { message?: string }
      if (!response.ok) throw new Error(data.message || '核销失败')
      setMessage('✓ 核销成功'); setRedeemSuccess(true); setVerifyPreview(null); setVerifyToken(''); setVerifyCodeInput(''); if (tab === 'orders') await loadOrders()
    } catch (error) { setMessage(error instanceof Error ? error.message : '核销失败') } finally { setBusy(false) }
  }

  function continueScanning() {
    setMessage('')
    setRedeemSuccess(false)
    setVerifyPreview(null)
    setVerifyToken('')
    setVerifyCodeInput('')
    setScannerOpen(true)
  }

  async function refund(order: Order) {
    const reason = window.prompt('请填写退款原因')
    if (!reason) return
    const restoreStock = window.confirm('是否同时恢复库存？')
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/material-redemptions/orders/${order.id}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, restoreStock }) })
      const data = await response.json() as { message?: string }
      if (!response.ok) throw new Error(data.message || '退款失败')
      setMessage('退款处理完成'); await loadOrders()
    } catch (error) { setMessage(error instanceof Error ? error.message : '退款失败') } finally { setBusy(false) }
  }

  return (
    <section className="space-y-5 border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap gap-2 border-b border-sky-100 pb-3"><button type="button" onClick={() => setTab('materials')} className={`min-h-10 border px-4 text-sm font-black ${tab === 'materials' ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-slate-600'}`}>物料管理</button><button type="button" onClick={() => setTab('orders')} className={`min-h-10 border px-4 text-sm font-black ${tab === 'orders' ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-slate-600'}`}>兑换订单</button><button type="button" onClick={() => setTab('verify')} className={`min-h-10 border px-4 text-sm font-black ${tab === 'verify' ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-slate-600'}`}>扫码核销</button></div>
      {message ? <p className="border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-brand-700">{message}</p> : null}

      {tab === 'materials' ? <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <div className="min-w-0 space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">已有物料</h2><button type="button" onClick={startCreate} className="min-h-10 bg-brand-950 px-4 text-sm font-black text-white">新建物料</button></div>{materials.map((material) => <article key={material.id} className={`min-w-0 border p-4 ${editing === material.id ? 'border-brand-700 bg-sky-50/50' : 'border-sky-100 bg-white'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-black text-brand-950">{material.title}</h3><p className="mt-1 text-xs font-bold text-slate-500">{material.status} · {material.stateLabel}{material.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED' ? ' · 需报名指定活动' : ''}</p>{material.linkedActivity ? <p className="mt-1 text-xs font-black text-emerald-700">关联活动：{material.linkedActivity.title}</p> : null}<p className="mt-1 text-xs font-bold text-slate-500">总库存 {material.stockTotal} · 已兑换 {material.exchangedQuantity ?? Math.max(0, material.stockTotal - material.stockRemaining)} · 已核销 {material.redeemedQuantity ?? 0} · 剩余 {material.stockRemaining}</p></div><button type="button" onClick={() => startEdit(material)} className="min-h-9 border border-brand-700 px-3 text-xs font-black text-brand-700">编辑</button></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void adjustStock(material, 1)} disabled={busy} className="min-h-9 border border-sky-200 px-3 text-xs font-black text-slate-600">库存 +1</button><button type="button" onClick={() => void adjustStock(material, -1)} disabled={busy || material.stockRemaining < 1} className="min-h-9 border border-sky-200 px-3 text-xs font-black text-slate-600">库存 -1</button><button type="button" onClick={() => { setQuery(material.title); setTab('orders') }} className="min-h-9 border border-brand-700 px-3 text-xs font-black text-brand-700">查看订单</button></div></article>)}</div>
        <div className="min-w-0 border border-sky-100 p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">{selected ? '编辑物料' : '新建物料'}</h2>{selected ? <span className="text-xs font-bold text-slate-500">{selected.id}</span> : null}</div><div className="mt-4 grid gap-3"><label className="text-sm font-black text-brand-950">标题<input value={form.title} onChange={(event) => updateForm('title', event.target.value)} className="mt-1 h-11 w-full border border-sky-200 px-3" maxLength={100} /></label><label className="text-sm font-black text-brand-950">说明<textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} className="mt-1 min-h-24 w-full border border-sky-200 p-3" maxLength={5000} /></label><label className="text-sm font-black text-brand-950">兑换说明<textarea value={form.instructions} onChange={(event) => updateForm('instructions', event.target.value)} className="mt-1 min-h-20 w-full border border-sky-200 p-3" maxLength={5000} /></label><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-black text-brand-950">消耗挂号费<input type="number" min={0} value={form.cost} onChange={(event) => updateForm('cost', Number(event.target.value))} className="mt-1 h-11 w-full border border-sky-200 px-3" /></label><label className="text-sm font-black text-brand-950">库存总量<input type="number" min={0} value={form.stockTotal} onChange={(event) => updateForm('stockTotal', Number(event.target.value))} className="mt-1 h-11 w-full border border-sky-200 px-3" /></label><label className="text-sm font-black text-brand-950">每人限兑<input type="number" min={1} value={form.perUserLimit} onChange={(event) => updateForm('perUserLimit', Number(event.target.value))} className="mt-1 h-11 w-full border border-sky-200 px-3" /></label></div><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-black text-brand-950">开始<input type="datetime-local" value={form.exchangeStartAt} onChange={(event) => updateForm('exchangeStartAt', event.target.value)} className="mt-1 h-11 w-full min-w-0 border border-sky-200 px-2" disabled={form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED'} /></label><label className="text-sm font-black text-brand-950">兑换截止<input type="datetime-local" value={form.exchangeEndAt} onChange={(event) => updateForm('exchangeEndAt', event.target.value)} className="mt-1 h-11 w-full min-w-0 border border-sky-200 px-2" disabled={form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED'} /></label><label className="text-sm font-black text-brand-950">核销截止<input type="datetime-local" value={form.redeemEndAt} onChange={(event) => updateForm('redeemEndAt', event.target.value)} className="mt-1 h-11 w-full min-w-0 border border-sky-200 px-2" disabled={form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED'} /></label></div><label className="text-sm font-black text-brand-950">状态<select value={form.status} onChange={(event) => updateForm('status', event.target.value)} className="mt-1 h-11 w-full border border-sky-200 px-3"><option value="DRAFT">草稿</option><option value="PUBLISHED">发布</option><option value="PAUSED">暂停兑换</option><option value="ENDED">结束兑换</option><option value="ARCHIVED">归档</option></select></label><div><p className="text-sm font-black text-brand-950">封面图片</p><div className="mt-1 flex flex-wrap items-center gap-2"><input value={form.coverImageUrl} onChange={(event) => updateForm('coverImageUrl', event.target.value)} className="h-11 min-w-0 flex-1 border border-sky-200 px-3 text-sm" placeholder="上传后自动填入 COS 地址" /><label className="inline-flex min-h-11 cursor-pointer items-center border border-brand-700 px-3 text-sm font-black text-brand-700">上传<input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(file) }} /></label></div></div><label className="text-sm font-black text-brand-950">兑换规则<select value={form.redemptionRule} onChange={(event) => { const value = event.target.value; updateForm('redemptionRule', value); if (value === 'ACTIVITY_REGISTRATION_REQUIRED') { updateForm('rules', [{ type: 'ACTIVITY_REGISTRATION_REQUIRED', operator: 'EQ', value: form.linkedActivityId || '' }]); void loadRuleOptions(value) } else if (form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED') updateForm('rules', [{ type: 'NONE', operator: 'EQ', value: '' }]) }} className="mt-1 h-11 w-full border border-sky-200 px-3"><option value="DEFAULT">原有兑换规则</option><option value="ACTIVITY_REGISTRATION_REQUIRED">需报名指定活动</option></select><span className="mt-1 block text-xs font-bold text-slate-500">指定活动物料不在物料页单独扣费，由活动报名时自动兑换。</span></label>{form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED' ? <label className="text-sm font-black text-brand-950">指定活动<select value={form.linkedActivityId} onChange={(event) => { const value = event.target.value; updateForm('linkedActivityId', value); updateForm('rules', [{ type: 'ACTIVITY_REGISTRATION_REQUIRED', operator: 'EQ', value }]) }} className="mt-1 h-11 w-full border border-sky-200 px-3"><option value="">请选择活动</option>{(options.ACTIVITY_REGISTRATION_REQUIRED || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><span className="mt-1 block text-xs font-bold text-slate-500">兑换时间将自动继承该活动的实际开始/结束时间。</span></label> : null}<div className={form.redemptionRule === 'ACTIVITY_REGISTRATION_REQUIRED' ? 'hidden' : ''}><div className="flex items-center justify-between gap-2"><p className="text-sm font-black text-brand-950">兑换条件（全部同时满足）</p><button type="button" onClick={() => updateForm('rules', [...form.rules, { type: 'REGISTER_DAYS', operator: 'GTE', value: '0' }])} className="text-xs font-black text-brand-700">+ 添加条件</button></div><div className="mt-2 space-y-2">{form.rules.map((rule, index) => <div key={`${index}-${rule.type}`} className="grid min-w-0 gap-2 border border-sky-100 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"><select value={rule.type} onChange={(event) => { updateRule(index, 'type', event.target.value); void loadRuleOptions(event.target.value) }} className="h-10 min-w-0 border border-sky-200 px-2 text-sm"><option value="NONE">无门槛</option><option value="REGISTER_DAYS">注册满指定天数</option><option value="CHECKIN_TOTAL">累计挂号天数</option><option value="CHECKIN_STREAK">连续挂号天数</option><option value="HAS_BADGE">拥有指定勋章</option><option value="ATTENDED_CONCERT">记录过指定演唱会</option><option value="SPECIFIC_USER">指定用户</option></select><select value={rule.operator} onChange={(event) => updateRule(index, 'operator', event.target.value)} className="h-10 min-w-0 border border-sky-200 px-2 text-sm" disabled={!numericRules.has(rule.type)}><option value="GTE">大于等于</option><option value="EQ">等于</option><option value="LTE">小于等于</option></select>{optionKinds[rule.type] ? <select value={rule.value} onChange={(event) => updateRule(index, 'value', event.target.value)} className="h-10 min-w-0 border border-sky-200 px-2 text-sm"><option value="">请选择{ruleLabels[rule.type]}</option>{(options[rule.type] || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input value={rule.type === 'NONE' ? '' : rule.value} onChange={(event) => updateRule(index, 'value', event.target.value)} disabled={rule.type === 'NONE'} type={numericRules.has(rule.type) ? 'number' : 'text'} className="h-10 min-w-0 border border-sky-200 px-2 text-sm" placeholder={rule.type === 'NONE' ? '无需填写' : '条件值'} />}{form.rules.length > 1 ? <button type="button" onClick={() => updateForm('rules', form.rules.filter((_, ruleIndex) => ruleIndex !== index))} className="h-10 px-2 text-sm font-black text-rose-600">删除</button> : null}</div>)}</div><div className="mt-3 border border-sky-100 bg-sky-50/50 p-3"><p className="text-xs font-black text-brand-950">选择勋章、演唱会或指定用户</p><div className="mt-2 flex flex-col gap-2 sm:flex-row"><select value={ruleSearchIndex} onChange={(event) => setRuleSearchIndex(Number(event.target.value))} className="h-10 min-w-0 border border-sky-200 px-2 text-sm">{form.rules.map((rule, index) => <option key={index} value={index}>{index + 1}. {ruleLabels[rule.type]}</option>)}</select><input value={ruleSearch[ruleSearchIndex] || ''} onChange={(event) => setRuleSearch((current) => ({ ...current, [ruleSearchIndex]: event.target.value }))} className="h-10 min-w-0 flex-1 border border-sky-200 px-2 text-sm" placeholder="输入昵称 / E院ID / 关键词后搜索" /><button type="button" onClick={() => { const rule = form.rules[ruleSearchIndex]; if (rule) void loadRuleOptions(rule.type, ruleSearch[ruleSearchIndex] || '') }} className="h-10 border border-brand-700 px-3 text-sm font-black text-brand-700">搜索候选</button></div></div></div><button type="button" onClick={() => void saveMaterial()} disabled={busy} className="mt-2 min-h-11 bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-40">{busy ? '处理中…' : '保存物料'}</button></div></div>
      </div> : null}

      {tab === 'orders' ? <div className="min-w-0 space-y-4"><div className="flex flex-col gap-2 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 min-w-0 flex-1 border border-sky-200 px-3" placeholder="搜索兑换码、物料名称、昵称或 E院ID" /><select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)} className="min-h-11 border border-sky-200 px-3 text-sm font-black"><option value="">全部状态</option><option value="SUCCESS">待核销</option><option value="REDEEMED">已核销</option><option value="CANCELLED">兑换已取消</option><option value="EXPIRED">已超过核销截止时间</option><option value="REFUNDED">已退款，兑换码无效</option></select><button type="button" onClick={() => void loadOrders()} className="min-h-11 bg-brand-950 px-4 text-sm font-black text-white">搜索</button></div><div className="overflow-x-auto"><table className="min-w-[1080px] w-full text-left text-sm"><thead className="border-b border-sky-100 text-xs font-black text-slate-500"><tr><th className="px-2 py-3">物料</th><th className="px-2 py-3">来源/关联活动</th><th className="px-2 py-3">用户</th><th className="px-2 py-3">数量/挂号费</th><th className="px-2 py-3">状态</th><th className="px-2 py-3">兑换码</th><th className="px-2 py-3">时间</th><th className="px-2 py-3">操作</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b border-sky-50"><td className="px-2 py-3 font-black text-brand-950">{order.material.title}</td><td className="px-2 py-3 text-xs font-bold text-slate-600"><span className={order.source === 'ACTIVITY_REGISTRATION_AUTO' ? 'text-emerald-700' : ''}>{order.sourceLabel}</span>{order.linkedActivity ? <><br />活动：{order.linkedActivity.title}</> : null}{order.redemptionSourceLabel ? <><br />核销：{order.redemptionSourceLabel}</> : null}</td><td className="px-2 py-3 font-bold text-slate-600">{order.user.nickname} · {order.user.uid}</td><td className="px-2 py-3 font-bold text-slate-600">{order.quantity} / {order.totalCost}</td><td className="px-2 py-3 font-black text-brand-700">{order.statusLabel}</td><td className="px-2 py-3 font-mono text-xs">{order.redeemCode}</td><td className="whitespace-nowrap px-2 py-3 text-xs font-bold text-slate-500">兑换 {new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}<br />{order.redeemedAt ? `核销 ${new Date(order.redeemedAt).toLocaleString('zh-CN', { hour12: false })}` : '未核销'}</td><td className="px-2 py-3">{order.status === 'SUCCESS' && order.source !== 'ACTIVITY_REGISTRATION_AUTO' ? <button type="button" onClick={() => void refund(order)} disabled={busy} className="min-h-9 border border-amber-300 px-3 text-xs font-black text-amber-700">退款</button> : '—'}</td></tr>)}</tbody></table></div></div> : null}

      {tab === 'verify' ? <div className="mx-auto max-w-2xl space-y-4">
        <div><h2 className="text-xl font-black text-brand-950">管理员确认核销</h2><p className="mt-2 text-sm font-bold leading-6 text-slate-600">扫描二维码后只查询订单，确认物料、用户和数量无误，再手动确认交付。二维码不会自动核销。</p></div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <div className="min-w-0">
            <label className="block text-sm font-black text-brand-950" htmlFor="material-redemption-code">兑换码</label>
            <div className="mt-1 flex min-h-11 min-w-0 border border-sky-200 bg-white">
              <span className="inline-flex shrink-0 items-center border-r border-sky-100 bg-sky-50 px-3 font-mono text-sm font-black text-brand-700">ECFC-</span>
              <input id="material-redemption-code" value={verifyCodeInput} onChange={(event) => handleVerifyCodeInput(event.target.value)} className="min-w-0 flex-1 px-3 font-mono text-sm outline-none" placeholder="输入兑换码后缀" inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500">无需输入 ECFC-；粘贴完整 ECFC- 或历史 EFC- 兑换码也可以。</p>
            {verifyToken && !verifyCodeInput ? <p className="mt-1 text-xs font-bold text-brand-700">已载入二维码令牌，点击查询订单。</p> : null}
          </div>
          <button type="button" onClick={openScanner} className="order-first min-h-11 border border-emerald-700 bg-emerald-700 px-5 text-sm font-black text-white shadow-sm sm:order-none">扫码核销</button>
          <button type="button" onClick={() => void previewVerify()} disabled={!verifyToken.trim()} className="min-h-11 bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-40">查询订单</button>
        </div>
        {verifyPreview ? <div className="border border-sky-100 bg-sky-50/50 p-4 sm:p-5">
          <div className="flex min-w-0 gap-4">
            <div className="size-20 shrink-0 overflow-hidden border border-sky-100 bg-[var(--surface-subtle)] sm:size-24">{verifyPreview.material.coverImageUrl ? <img src={verifyPreview.material.coverImageUrl} alt="" className="size-full object-contain" /> : <div className="grid size-full place-items-center text-3xl">🎁</div>}</div>
            <div className="min-w-0"><p className="break-words text-lg font-black text-brand-950">{verifyPreview.material.title}</p><p className="mt-2 text-sm font-bold text-slate-600">用户：{verifyPreview.user.nickname}</p><p className="mt-1 text-sm font-bold text-slate-600">E院ID：{verifyPreview.user.uid} · 数量：{verifyPreview.quantity}</p></div>
          </div>
          <dl className="mt-4 grid gap-2 border-t border-sky-100 pt-4 text-sm font-bold text-slate-600 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">状态</dt><dd className="mt-1 font-black text-brand-700">{verifyPreview.activityCancelled ? '活动已取消' : verifyPreview.notStarted ? '活动尚未开始' : verifyPreview.expired ? '已超过核销截止时间' : verifyPreview.statusLabel}</dd></div><div><dt className="text-xs text-slate-500">兑换码</dt><dd className="mt-1 break-all font-mono font-black text-brand-950">{verifyPreview.redeemCode}</dd></div><div><dt className="text-xs text-slate-500">兑换时间</dt><dd className="mt-1">{new Date(verifyPreview.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd></div><div><dt className="text-xs text-slate-500">核销截止</dt><dd className="mt-1">{new Date(verifyPreview.material.redeemEndAt).toLocaleString('zh-CN', { hour12: false })}</dd></div></dl>
          {verifyPreview.redeemedAt ? <p className="mt-3 border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">已于 {new Date(verifyPreview.redeemedAt).toLocaleString('zh-CN', { hour12: false })} 由 {verifyPreview.redeemedByAdmin?.nickname || '其他管理员'} 核销。</p> : null}
          <button type="button" onClick={() => void confirmVerify()} disabled={busy || !verifyPreview.canRedeem} className="mt-4 min-h-11 w-full bg-emerald-700 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{verifyPreview.canRedeem ? '确认核销' : verifyPreview.activityCancelled ? '活动已取消' : verifyPreview.notStarted ? '活动尚未开始' : verifyPreview.expired ? '已超过核销截止时间' : verifyPreview.statusLabel}</button>
        </div> : null}
        {redeemSuccess ? <button type="button" onClick={continueScanning} className="min-h-11 w-full border border-emerald-700 px-5 text-sm font-black text-emerald-700">继续扫描下一份</button> : null}
      </div> : null}
      <MaterialRedemptionScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScannedIdentifier} />
    </section>
  )
}
