'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from '@/components/UiIcon'
import { findPaletteColorByCode, normalizePaletteCode } from '@/lib/studio/beads/palette'
import type { BeadPaletteColor } from '@/lib/studio/beads/types'
import styles from './studio.module.css'

type BeadPalettePickerProps = Readonly<{
  palette: readonly BeadPaletteColor[]
  selectedIndex: number
  onSelect: (index: number) => void
  recentCodes?: readonly string[]
  onRecentChange?: (code: string) => void
  label?: string
  compact?: boolean
}>

export function BeadPalettePicker({ palette, selectedIndex, onSelect, recentCodes = [], onRecentChange, label = '选择颜色', compact = false }: BeadPalettePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualError, setManualError] = useState('')
  const selected = palette[selectedIndex] || palette[0] || null
  const normalizedQuery = normalizePaletteCode(query)
  const filtered = useMemo(() => palette
    .map((color, index) => ({ color, index }))
    .filter(({ color }) => !normalizedQuery || [color.code, color.brandCode || '', color.originalCode || '', color.displayCode || '', color.name, color.hex, `${color.rgb.r} ${color.rgb.g} ${color.rgb.b}`, ...color.groups].some((value) => normalizePaletteCode(value).includes(normalizedQuery))), [normalizedQuery, palette])
  const recent = useMemo(() => recentCodes
    .map((code) => {
      const color = findPaletteColorByCode(palette, code)
      return color ? { color, index: palette.indexOf(color) } : null
    })
    .filter((item): item is { color: BeadPaletteColor; index: number } => Boolean(item)), [palette, recentCodes])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function select(index: number) {
    const color = palette[index]
    if (!color) return
    onSelect(index)
    onRecentChange?.(color.code)
    setManualError('')
    setOpen(false)
  }

  function submitManualCode() {
    const normalized = normalizePaletteCode(manualCode)
    const color = findPaletteColorByCode(palette, normalized)
    if (!color) {
      setManualError(`未找到色号 ${normalized || manualCode.trim() || '（空）'}`)
      return
    }
    select(palette.indexOf(color))
    setManualCode('')
  }

  return <div ref={rootRef} className={`${styles.palettePicker} ${compact ? styles.palettePickerCompact : ''}`}>
    <button type="button" className={styles.palettePickerTrigger} onClick={() => { setOpen((current) => !current); setManualError('') }} aria-haspopup="dialog" aria-expanded={open} aria-label={selected ? `${label}：${selected.code} ${selected.name}` : label}>
      {selected ? <i className={styles.palettePickerSwatch} style={{ background: selected.hex }} /> : <i className={styles.palettePickerSwatch} />}
      <span className={styles.palettePickerTriggerText}><b>{selected?.code || '未选择'}</b><small>{selected?.name || '暂无颜色'}</small></span>
      <UiIcon name="palette" className={styles.palettePickerIcon} />
    </button>
    {open ? <div className={styles.palettePickerPanel} role="dialog" aria-label={label}>
      <div className={styles.palettePickerHeader}><strong>{label}</strong><button type="button" className={styles.palettePickerClose} onClick={() => setOpen(false)} aria-label="关闭颜色选择器">×</button></div>
      <label className={styles.palettePickerSearch}><UiIcon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 A1 / A01 / HEX" aria-label="搜索色号、HEX 或颜色名称" /></label>
      <div className={styles.palettePickerManual}><input value={manualCode} onChange={(event) => { setManualCode(event.target.value); setManualError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitManualCode() } }} placeholder="输入色号，如 A04" aria-label="手动输入色号" /><button type="button" onClick={submitManualCode}>输入色号</button></div>
      {manualError ? <p className={styles.palettePickerError} role="alert">{manualError}</p> : null}
      {recent.length ? <section className={styles.palettePickerSection}><span className={styles.palettePickerSectionTitle}>最近使用</span><div className={styles.palettePickerRecent}>{recent.map(({ color, index }) => <button key={`recent-${color.code}`} type="button" className={`${styles.palettePickerChip} ${selectedIndex === index ? styles.palettePickerChipActive : ''}`} onClick={() => select(index)} title={`${color.code} ${color.name}`}><i style={{ background: color.hex }} />{color.code}</button>)}</div></section> : null}
      <section className={styles.palettePickerSection}><span className={styles.palettePickerSectionTitle}>标准色库 · {filtered.length}/{palette.length}</span><div className={styles.palettePickerGrid}>{filtered.map(({ color, index }) => <button key={`${color.code}-${index}`} type="button" className={`${styles.palettePickerColor} ${selectedIndex === index ? styles.palettePickerColorActive : ''}`} onClick={() => select(index)} aria-label={`${color.code} ${color.name} ${color.hex} ${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b}`} aria-pressed={selectedIndex === index}><i className={styles.palettePickerColorSwatch} style={{ background: color.hex }} /><span><b>{color.displayCode || color.code}</b><small>{color.name} · {color.hex}</small><em>{color.rgb.r}, {color.rgb.g}, {color.rgb.b}</em></span></button>)}</div>{!filtered.length ? <p className={styles.settingsSubtle}>没有匹配的颜色。</p> : null}</section>
    </div> : null}
  </div>
}
