'use client'

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { UiIcon } from '@/components/UiIcon'
import type { EcenterFeatureItem } from '@/lib/ecenter-features'

type EditorFeature = EcenterFeatureItem

type EcenterShortcutEditorPanelProps = Readonly<{
  initialFeatures: readonly EditorFeature[]
  onSaved: (features: EditorFeature[]) => void
  onDone: () => void
  variant: 'mobile' | 'sidebar'
}>

function normalizeOrder(features: readonly EditorFeature[]) {
  const visible = features.filter((feature) => !feature.hidden).sort((left, right) => left.sortOrder - right.sortOrder || left.defaultSortOrder - right.defaultSortOrder)
  const hidden = features.filter((feature) => feature.hidden).sort((left, right) => left.sortOrder - right.sortOrder || left.defaultSortOrder - right.defaultSortOrder)
  return [...visible.map((feature, index) => ({ ...feature, sortOrder: index })), ...hidden.map((feature, index) => ({ ...feature, sortOrder: visible.length + index }))]
}

function moveFeature(features: readonly EditorFeature[], featureKey: string, targetIndex: number) {
  const visible = features.filter((feature) => !feature.hidden).sort((left, right) => left.sortOrder - right.sortOrder)
  const currentIndex = visible.findIndex((feature) => feature.featureKey === featureKey)
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visible.length || currentIndex === targetIndex) return [...features]
  const [moved] = visible.splice(currentIndex, 1)
  visible.splice(targetIndex, 0, moved)
  const visibleKeys = new Set(visible.map((feature) => feature.featureKey))
  return normalizeOrder([
    ...visible,
    ...features.filter((feature) => !visibleKeys.has(feature.featureKey)),
  ])
}

function featurePayload(features: readonly EditorFeature[]) {
  return normalizeOrder(features).map((feature) => ({
    itemKey: feature.featureKey,
    sortOrder: feature.sortOrder,
    hidden: feature.hidden,
  }))
}

function featureFromApi(value: unknown): EditorFeature[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is EditorFeature => Boolean(item && typeof item === 'object' && 'featureKey' in item && 'label' in item && 'href' in item && 'icon' in item))
}

export function EcenterShortcutEditorPanel({ initialFeatures, onSaved, onDone, variant }: EcenterShortcutEditorPanelProps) {
  const [features, setFeatures] = useState<EditorFeature[]>(() => normalizeOrder(initialFeatures))
  const [draggedKey, setDraggedKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/users/me/e-center-preferences', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { features?: unknown; message?: string } | null
        if (!response.ok) throw new Error(payload?.message || 'E院中心设置暂时无法读取')
        const nextFeatures = featureFromApi(payload?.features)
        if (nextFeatures.length > 0) setFeatures(normalizeOrder(nextFeatures))
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== 'AbortError') setMessage(error instanceof Error ? error.message : 'E院中心设置暂时无法读取')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const visibleFeatures = useMemo(() => normalizeOrder(features).filter((feature) => !feature.hidden), [features])
  const hiddenFeatures = useMemo(() => normalizeOrder(features).filter((feature) => feature.hidden), [features])

  function updateFeatures(next: readonly EditorFeature[]) {
    setFeatures(normalizeOrder(next))
    setDirty(true)
    setMessage('')
  }

  function moveTo(featureKey: string, targetIndex: number) {
    updateFeatures(moveFeature(features, featureKey, targetIndex))
  }

  function handleDragStart(event: DragEvent<HTMLElement>, featureKey: string) {
    setDraggedKey(featureKey)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', featureKey)
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetKey: string) {
    event.preventDefault()
    const sourceKey = draggedKey || event.dataTransfer.getData('text/plain')
    const targetIndex = visibleFeatures.findIndex((feature) => feature.featureKey === targetKey)
    if (sourceKey && targetIndex >= 0) moveTo(sourceKey, targetIndex)
    setDraggedKey(null)
    setDropKey(null)
  }

  function hideFeature(featureKey: string) {
    updateFeatures(features.map((feature) => feature.featureKey === featureKey ? { ...feature, hidden: true } : feature))
  }

  function restoreFeature(featureKey: string) {
    const visibleCount = features.filter((feature) => !feature.hidden).length
    updateFeatures(features.map((feature) => feature.featureKey === featureKey ? { ...feature, hidden: false, sortOrder: visibleCount } : feature))
  }

  async function persist(reset = false) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/users/me/e-center-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { preferences: featurePayload(features) }),
      })
      const payload = await response.json().catch(() => null) as { features?: unknown; message?: string } | null
      if (!response.ok) throw new Error(payload?.message || 'E院中心设置暂时无法保存')
      const nextFeatures = featureFromApi(payload?.features)
      if (nextFeatures.length > 0) {
        const normalized = normalizeOrder(nextFeatures)
        setFeatures(normalized)
        onSaved(normalized)
      }
      setDirty(false)
      setMessage(payload?.message || 'E院中心设置已保存')
      return true
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'E院中心设置暂时无法保存')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleDone() {
    if (dirty && !(await persist())) return
    onDone()
  }

  async function handleReset() {
    if (!window.confirm('确定恢复 E院中心默认布局吗？你的自定义排序和隐藏设置将被重置。')) return
    await persist(true)
  }

  const controlLabel = '隐藏'

  return <section className={`ecenter-shortcut-editor ecenter-shortcut-editor-${variant}`} aria-label="编辑 E院中心">
    <div className="ecenter-editor-heading">
      <div>
        <p className="ecenter-editor-kicker">E院中心</p>
        <h3>编辑快捷入口</h3>
      </div>
      <button type="button" className="ecenter-editor-done" onClick={() => void handleDone()} disabled={saving}>{saving ? '保存中…' : '完成'}</button>
    </div>
    {loading ? <p className="ecenter-editor-state">正在读取你的布局…</p> : null}
    <p className="ecenter-editor-hint">拖动卡片调整顺序；手机端也可以使用上下按钮。</p>
    <div className="ecenter-editor-list" aria-label="可见快捷入口">
      {visibleFeatures.map((feature, index) => <article
        key={feature.featureKey}
        className={`ecenter-editor-item${draggedKey === feature.featureKey ? ' is-dragging' : ''}${dropKey === feature.featureKey ? ' is-drop-target' : ''}`}
        draggable
        onDragStart={(event) => handleDragStart(event, feature.featureKey)}
        onDragEnd={() => { setDraggedKey(null); setDropKey(null) }}
        onDragOver={(event) => { event.preventDefault(); setDropKey(feature.featureKey) }}
        onDrop={(event) => handleDrop(event, feature.featureKey)}
      >
        <span className="ecenter-editor-drag-handle" aria-hidden="true">≡</span>
        <span className="ecenter-editor-icon"><UiIcon name={feature.icon} /></span>
        <span className="ecenter-editor-label">{feature.label}</span>
        <span className="ecenter-editor-actions">
          <button type="button" onClick={() => moveTo(feature.featureKey, index - 1)} disabled={index === 0} aria-label={`将${feature.label}上移`}>↑</button>
          <button type="button" onClick={() => moveTo(feature.featureKey, index + 1)} disabled={index === visibleFeatures.length - 1} aria-label={`将${feature.label}下移`}>↓</button>
          <button type="button" className="ecenter-editor-hide" onClick={() => hideFeature(feature.featureKey)}>{controlLabel}</button>
        </span>
      </article>)}
      {visibleFeatures.length === 0 ? <p className="ecenter-editor-state">当前没有显示中的快捷入口。</p> : null}
    </div>
    <details className="ecenter-hidden-features">
      <summary>已隐藏的功能 ({hiddenFeatures.length})</summary>
      <div>
        {hiddenFeatures.length === 0 ? <p className="ecenter-editor-state">暂无隐藏功能</p> : hiddenFeatures.map((feature) => <div className="ecenter-hidden-feature" key={feature.featureKey}>
          <span><UiIcon name={feature.icon} />{feature.label}</span>
          <button type="button" onClick={() => restoreFeature(feature.featureKey)}>恢复显示</button>
        </div>)}
      </div>
    </details>
    <div className="ecenter-editor-footer">
      <button type="button" className="ecenter-reset-layout" onClick={() => void handleReset()} disabled={saving}>恢复默认布局</button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  </section>
}

export function EcenterEditButton({ onClick, children = '编辑' }: Readonly<{ onClick: () => void; children?: ReactNode }>) {
  return <button type="button" className="ecenter-edit-button" onClick={onClick}><UiIcon name="edit" />{children}</button>
}
