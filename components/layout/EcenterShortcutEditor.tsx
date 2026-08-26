'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { UiIcon } from '@/components/UiIcon'
import {
  normalizeEcenterFeatureOrder,
  reorderEcenterFeatures,
  setEcenterFeatureHidden,
  type EcenterFeatureItem,
} from '@/lib/ecenter-features'

type EditorFeature = EcenterFeatureItem
type EditorListSection = 'primary' | 'quick' | 'center'
type EditorFeatureGroup = { key: EditorListSection; label?: string; features: EditorFeature[] }

type EcenterShortcutEditorPanelProps = Readonly<{
  initialFeatures: readonly EditorFeature[]
  onSaved: (features: EditorFeature[]) => void
  onDone: () => void
  variant: 'mobile' | 'sidebar'
}>

function featurePayload(features: readonly EditorFeature[]) {
  return normalizeEcenterFeatureOrder(features).map((feature) => ({
    itemKey: feature.featureKey,
    sortOrder: feature.sortOrder,
    hidden: feature.hidden,
  }))
}

function featureFromApi(value: unknown): EditorFeature[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is EditorFeature => Boolean(item && typeof item === 'object' && 'featureKey' in item && 'label' in item && 'href' in item && 'icon' in item))
}

function featureBelongsToEditor(
  feature: EditorFeature,
  variant: EcenterShortcutEditorPanelProps['variant'],
  section?: EditorListSection,
) {
  if (variant === 'sidebar') {
    return feature.showInDesktopSidebar && (!section || feature.sidebarSection === section)
  }
  return feature.showInCenter
}

export function EcenterShortcutEditorPanel({ initialFeatures, onSaved, onDone, variant }: EcenterShortcutEditorPanelProps) {
  const [features, setFeatures] = useState<EditorFeature[]>(() => normalizeEcenterFeatureOrder(initialFeatures))
  const featuresRef = useRef<EditorFeature[]>(features)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const pointerDragRef = useRef<{ pointerId: number; featureKey: string; section: EditorListSection } | null>(null)
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
        if (nextFeatures.length > 0) {
          const normalized = normalizeEcenterFeatureOrder(nextFeatures)
          featuresRef.current = normalized
          setFeatures(normalized)
        }
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== 'AbortError') setMessage(error instanceof Error ? error.message : 'E院中心设置暂时无法读取')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const featureGroups = useMemo<EditorFeatureGroup[]>(() => {
    const sections: EditorListSection[] = variant === 'sidebar' ? ['primary', 'quick'] : ['center']
    return sections.map((section) => ({
      key: section,
      label: variant === 'sidebar' ? (section === 'primary' ? '主要导航' : '快捷入口') : undefined,
      features: features.filter((feature) => !feature.hidden && featureBelongsToEditor(feature, variant, section)),
    }))
  }, [features, variant])
  const visibleFeatures = useMemo(() => featureGroups.flatMap((group) => group.features), [featureGroups])
  const hiddenFeatures = useMemo(() => features.filter((feature) => feature.hidden && featureBelongsToEditor(feature, variant)), [features, variant])
  const ecenterOnlyFeatures = useMemo(() => variant === 'sidebar'
    ? features.filter((feature) => feature.showInCenter && !feature.showInDesktopSidebar)
    : [], [features, variant])

  function updateFeatures(next: readonly EditorFeature[]) {
    const normalized = normalizeEcenterFeatureOrder(next)
    featuresRef.current = normalized
    setFeatures(normalized)
    setDirty(true)
    setMessage('')
  }

  function hasSameOrder(left: readonly EditorFeature[], right: readonly EditorFeature[]) {
    return left.length === right.length && left.every((feature, index) => (
      feature.featureKey === right[index]?.featureKey
      && feature.hidden === right[index]?.hidden
    ))
  }

  function moveTo(featureKey: string, targetIndex: number, section: EditorListSection) {
    if (loading || saving) return
    const next = reorderEcenterFeatures(featuresRef.current, featureKey, targetIndex, { include: (feature) => featureBelongsToEditor(feature, variant, section) })
    if (!hasSameOrder(featuresRef.current, next)) updateFeatures(next)
  }

  function getDropIndex(clientY: number, section: EditorListSection) {
    const sortableFeatures = featuresRef.current.filter((feature) => !feature.hidden && featureBelongsToEditor(feature, variant, section))
    if (!sortableFeatures.length) return -1
    const targetIndex = sortableFeatures.findIndex((feature) => {
      const element = itemRefs.current.get(feature.featureKey)
      if (!element) return false
      const rect = element.getBoundingClientRect()
      return clientY < rect.top + rect.height / 2
    })
    return targetIndex >= 0 ? targetIndex : sortableFeatures.length - 1
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, featureKey: string, section: EditorListSection) {
    if (loading || saving || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDragRef.current = { pointerId: event.pointerId, featureKey, section }
    setDraggedKey(featureKey)
    setDropKey(featureKey)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const sortableFeatures = featuresRef.current.filter((feature) => !feature.hidden && featureBelongsToEditor(feature, variant, drag.section))
    const targetIndex = getDropIndex(event.clientY, drag.section)
    const targetFeature = sortableFeatures[targetIndex]
    setDropKey(targetFeature?.featureKey || null)
    if (targetIndex >= 0) moveTo(drag.featureKey, targetIndex, drag.section)
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    pointerDragRef.current = null
    setDraggedKey(null)
    setDropKey(null)
  }

  function hideFeature(featureKey: string) {
    if (loading || saving) return
    updateFeatures(setEcenterFeatureHidden(featuresRef.current, featureKey, true))
  }

  function restoreFeature(featureKey: string) {
    if (loading || saving) return
    updateFeatures(setEcenterFeatureHidden(featuresRef.current, featureKey, false))
  }

  async function persist(reset = false) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/users/me/e-center-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { preferences: featurePayload(featuresRef.current) }),
      })
      const payload = await response.json().catch(() => null) as { features?: unknown; message?: string } | null
      if (!response.ok) throw new Error(payload?.message || 'E院中心设置暂时无法保存')
      const nextFeatures = featureFromApi(payload?.features)
      if (nextFeatures.length > 0) {
        const normalized = normalizeEcenterFeatureOrder(nextFeatures)
        featuresRef.current = normalized
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
    {variant === 'sidebar' ? <header className="ecenter-editor-modal-header">
      <p>EASON FANS CLUB</p>
      <div>
        <h2>编辑 E院中心</h2>
      <button type="button" className="ecenter-editor-close" onClick={() => void handleDone()} disabled={loading || saving} aria-label="关闭编辑 E院中心">×</button>
      </div>
    </header> : null}
    <div className="ecenter-editor-heading">
      <div className="ecenter-editor-heading-copy">
        <p className="ecenter-editor-kicker">E院中心</p>
        <h3>编辑快捷入口</h3>
      </div>
      <button type="button" className="ecenter-editor-done" onClick={() => void handleDone()} disabled={loading || saving}>{saving ? '保存中…' : '完成'}</button>
    </div>
    {loading ? <p className="ecenter-editor-state">正在读取你的布局…</p> : null}
    <p className="ecenter-editor-hint">按住左侧手柄拖动调整顺序；手机端也可以使用上下按钮。</p>
    <div className="ecenter-editor-list-heading"><h4>快捷入口列表</h4></div>
    <div className="ecenter-editor-list" aria-label="可见快捷入口" onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
      {featureGroups.map((group) => <div className="ecenter-editor-group" key={group.key}>
        {group.label ? <h5>{group.label}</h5> : null}
        {group.features.map((feature, index) => <article
          key={feature.featureKey}
          className={`ecenter-editor-item${draggedKey === feature.featureKey ? ' is-dragging' : ''}${dropKey === feature.featureKey ? ' is-drop-target' : ''}`}
          ref={(element) => {
            if (element) itemRefs.current.set(feature.featureKey, element)
            else itemRefs.current.delete(feature.featureKey)
          }}
        >
          <button
            type="button"
            className="ecenter-editor-drag-handle"
            onPointerDown={(event) => handlePointerDown(event, feature.featureKey, group.key)}
            aria-label={`拖动${feature.label}调整顺序`}
          >≡</button>
          <span className="ecenter-editor-icon"><UiIcon name={feature.icon} /></span>
          <span className="ecenter-editor-label">{feature.label}</span>
          <span className="ecenter-editor-actions">
            <button type="button" onClick={() => moveTo(feature.featureKey, index - 1, group.key)} disabled={loading || saving || index === 0} aria-label={`将${feature.label}上移`}>↑</button>
            <button type="button" onClick={() => moveTo(feature.featureKey, index + 1, group.key)} disabled={loading || saving || index === group.features.length - 1} aria-label={`将${feature.label}下移`}>↓</button>
            {feature.hideable
              ? <button type="button" className="ecenter-editor-hide" onClick={() => hideFeature(feature.featureKey)} disabled={loading || saving || !feature.editable}>{controlLabel}</button>
              : <span className="ecenter-editor-fixed">固定</span>}
          </span>
        </article>)}
      </div>)}
      {visibleFeatures.length === 0 ? <p className="ecenter-editor-state">当前没有显示中的快捷入口。</p> : null}
    </div>
    {variant === 'sidebar' && ecenterOnlyFeatures.length > 0 ? <section className="ecenter-editor-center-only" aria-label="仅在 E院中心展示的功能">
      <h4>仅在 E院中心展示</h4>
      <p>以下功能不属于桌面左侧导航，但仍保留在移动端 E院中心中。</p>
      <div>
        {ecenterOnlyFeatures.map((feature) => <div className="ecenter-editor-center-only-item" key={feature.featureKey}>
          <span><UiIcon name={feature.icon} />{feature.label}</span>
          {feature.hidden
            ? <button type="button" onClick={() => restoreFeature(feature.featureKey)} disabled={loading || saving || !feature.editable}>恢复显示</button>
            : <button type="button" onClick={() => hideFeature(feature.featureKey)} disabled={loading || saving || !feature.editable}>隐藏</button>}
        </div>)}
      </div>
    </section> : null}
    <details className="ecenter-hidden-features">
      <summary>已隐藏的功能 ({hiddenFeatures.length})</summary>
      <div>
        {hiddenFeatures.length === 0 ? <p className="ecenter-editor-state">暂无隐藏功能</p> : hiddenFeatures.map((feature) => <div className="ecenter-hidden-feature" key={feature.featureKey}>
          <span><UiIcon name={feature.icon} />{feature.label}</span>
          <button type="button" onClick={() => restoreFeature(feature.featureKey)} disabled={loading || saving}>恢复显示</button>
        </div>)}
      </div>
    </details>
    <div className="ecenter-editor-footer">
      <button type="button" className="ecenter-reset-layout" onClick={() => void handleReset()} disabled={loading || saving}>恢复默认布局</button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  </section>
}

export function EcenterEditButton({ onClick, children = '编辑' }: Readonly<{ onClick: () => void; children?: ReactNode }>) {
  return <button type="button" className="ecenter-edit-button" onClick={onClick}><UiIcon name="edit" />{children}</button>
}
