'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BadgeEffectType, BadgeGrantType, BadgeNicknameEffect, BadgeRarity, BadgeVisibility } from '@/lib/badge-types'
import { BADGE_EFFECT_TYPE_LABELS, BADGE_GRANT_TYPE_LABELS, BADGE_NICKNAME_SHINE_FALLBACK, BADGE_RARITY_LABELS, BADGE_VISIBILITY_LABELS, getBadgeNicknameShineColor, isBadgeNicknameShineEnabled } from '@/lib/badge-types'
import { BADGE_ADMIN_RULE_TYPES, BADGE_RULE_REGISTRY, BADGE_RULE_TYPE_DESCRIPTIONS, BADGE_RULE_TYPE_LABELS, generateBadgeAcquisitionDescription, parseBadgeRuleInput, type BadgeRuleOperatorValue, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import { BadgeImage, BadgeName, UserDisplayName } from '@/components/UserDisplayName'

export type AdminBadge = {
  id: string
  name: string
  code: string
  slug: string
  description: string | null
  acquisitionDescription: string | null
  acquisitionDescriptionCustomized: boolean
  rule: { id: string; ruleType: SupportedBadgeRuleType; operator: BadgeRuleOperatorValue; threshold: number | null; secondaryThreshold: number | null; configJson?: unknown; isEnabled: boolean } | null
  iconUrl: string | null
  category: string
  visibility: BadgeVisibility
  rarity: BadgeRarity
  grantType: BadgeGrantType
  isWearable: boolean
  isEnabled: boolean
  effectType: BadgeEffectType
  nicknameEffect: BadgeNicknameEffect
  nicknameColor: string | null
  nicknameGradientStart: string | null
  nicknameGradientEnd: string | null
  sortOrder: number
  ownerCount: number
  ownershipStats: { ownerCount: number; totalUsers: number; rate: number; display: string } | null
  seriesId: string | null
  series: { id: string; code: string; name: string; description: string | null; sortOrder: number; isEnabled: boolean } | null
  tierGroupCode: string | null
  tierLevel: number | null
  availableFrom: string | null
  availableUntil: string | null
  availabilityStatus: 'PERMANENT' | 'UPCOMING' | 'AVAILABLE' | 'ENDED'
  announceOnGrant: boolean
  countsTowardSeriesCompletion: boolean
  createdAt: string
}

type BadgeDraft = Omit<AdminBadge, 'id' | 'ownerCount' | 'createdAt' | 'isEnabled'> & { id?: string; isEnabled: boolean; imageUrl?: string | null; badgeType: 'STANDARD' | 'SERIES'; ruleType: SupportedBadgeRuleType; operator: BadgeRuleOperatorValue; threshold: number; ruleEnabled: boolean; legacyAuto: boolean; legacyTier: boolean; seriesCompletionRule: boolean; tierEnabled: boolean; limitedEnabled: boolean; targetId: string; targetLabel: string }
type AdminSeries = { id: string; code: string; name: string; description: string | null; sortOrder: number; isEnabled: boolean; completionRewardBadgeId: string | null; _count?: { Badges: number } }
type SeriesDraft = { id?: string; name: string; description: string; sortOrder: number; isEnabled: boolean; completionRewardBadgeId: string | null }
type ConcertOption = { id: string; title: string | null; concertDate: string; city: string; venue: string | null; MusicTour: { id: string; name: string } }
type TourOption = { id: string; name: string }
type ActivityOption = { id: string; title: string; status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'; startsAt: string | null; endsAt: string | null }

const emptyDraft: BadgeDraft = {
  name: '', code: '', slug: '', description: '', acquisitionDescription: '', acquisitionDescriptionCustomized: false, iconUrl: null, imageUrl: null, category: 'SYSTEM', visibility: 'PUBLIC', rarity: 'COMMON', grantType: 'MANUAL', isWearable: true, isEnabled: true, effectType: 'NONE', nicknameEffect: 'NONE', nicknameColor: '', nicknameGradientStart: '', nicknameGradientEnd: '', sortOrder: 0, rule: null, badgeType: 'STANDARD', seriesId: null, series: null, tierGroupCode: null, tierLevel: null, availableFrom: null, availableUntil: null, availabilityStatus: 'PERMANENT', ownershipStats: null, announceOnGrant: false, countsTowardSeriesCompletion: true, ruleType: 'POST_COUNT', operator: 'GTE', threshold: 1, ruleEnabled: true, legacyAuto: false, legacyTier: false, seriesCompletionRule: false, tierEnabled: false, limitedEnabled: false, targetId: '', targetLabel: '',
}

function toDraft(badge: AdminBadge): BadgeDraft {
  const rule = badge.rule
  const followsGeneratedDescription = badge.grantType === 'AUTO' && Boolean(rule) && !badge.acquisitionDescriptionCustomized && !isTargetRule(rule!.ruleType)
  const acquisitionDescription = followsGeneratedDescription
    ? generateBadgeAcquisitionDescription(rule!.ruleType, rule!.threshold)
    : badge.acquisitionDescription
  return {
    ...badge,
    imageUrl: badge.iconUrl,
    nicknameEffect: isBadgeNicknameShineEnabled(badge) ? 'COLOR' : 'NONE',
    nicknameColor: isBadgeNicknameShineEnabled(badge) ? getBadgeNicknameShineColor(badge) : '',
    // The columns stay in the DTO for backward compatibility, but are no
    // longer editable or used by the nickname renderer.
    nicknameGradientStart: '',
    nicknameGradientEnd: '',
    badgeType: badge.seriesId ? 'SERIES' : 'STANDARD',
    acquisitionDescription,
    ruleType: rule?.ruleType || 'POST_COUNT',
    operator: rule?.operator || 'GTE',
    threshold: rule?.threshold || 1,
    ruleEnabled: rule?.isEnabled ?? true,
    legacyAuto: badge.grantType === 'AUTO' && !badge.rule,
    legacyTier: badge.seriesId === null && badge.tierGroupCode !== null,
    seriesCompletionRule: rule?.ruleType === 'BADGE_SERIES_COMPLETE',
    tierEnabled: badge.tierGroupCode !== null || badge.tierLevel !== null,
    limitedEnabled: badge.availableFrom !== null || badge.availableUntil !== null,
    targetId: typeof (rule?.configJson as { concertId?: unknown; tourId?: unknown; activityId?: unknown } | null)?.concertId === 'string'
      ? String((rule?.configJson as { concertId: string }).concertId)
      : typeof (rule?.configJson as { tourId?: unknown } | null)?.tourId === 'string' ? String((rule?.configJson as { tourId: string }).tourId)
        : typeof (rule?.configJson as { activityId?: unknown } | null)?.activityId === 'string' ? String((rule?.configJson as { activityId: string }).activityId) : '',
    targetLabel: '',
  }
}

function defaultAcquisitionDescription(draft: Pick<BadgeDraft, 'grantType' | 'ruleType' | 'threshold'> & { legacyAuto?: boolean; targetLabel?: string }) {
  if (draft.grantType !== 'AUTO' || draft.legacyAuto) return ''
  if (draft.ruleType === 'CONCERT_SHOW_ATTENDED' && draft.targetLabel) return `观看「${draft.targetLabel}」后获得`
  if (draft.ruleType === 'CONCERT_TOUR_ATTENDED' && draft.targetLabel) return `观看「${draft.targetLabel}」巡演任意一场后获得`
  if (draft.ruleType === 'ACTIVITY_PARTICIPATION' && draft.targetLabel) return `参加「${draft.targetLabel}」后获得`
  return generateBadgeAcquisitionDescription(draft.ruleType, draft.threshold)
}

const RULE_GROUPS = ['社区', '挂号', '账号', '娱乐天空', 'EasMusic / 演唱会', '歌·颂', '活动'] as const
function isTargetRule(ruleType: SupportedBadgeRuleType) { return ruleType === 'CONCERT_SHOW_ATTENDED' || ruleType === 'CONCERT_TOUR_ATTENDED' || ruleType === 'ACTIVITY_PARTICIPATION' }
function getRuleUnit(ruleType: SupportedBadgeRuleType) {
  const definition = BADGE_RULE_REGISTRY[ruleType]
  return 'unit' in definition ? definition.unit : ''
}

function getBackfillUiState(badge: Pick<AdminBadge, 'rule' | 'availabilityStatus' | 'availableFrom' | 'availableUntil'>) {
  if (!badge.rule) return { disabled: true, label: '保存后扫描', reason: '请先保存结构化自动规则' }
  if (badge.availabilityStatus === 'UPCOMING') return { disabled: true, label: '限定尚未开始', reason: '限定勋章尚未开始，不能进行历史扫描' }
  const definition = BADGE_RULE_REGISTRY[badge.rule.ruleType]
  const limited = Boolean(badge.availableFrom || badge.availableUntil)
  if (limited && !definition.supportsHistoricalBackfill) return { disabled: true, label: '需手动补发', reason: `该规则无法可靠判断限定期历史资格：${definition.historicalBasis}` }
  return {
    disabled: false,
    label: limited ? '扫描限定期补发' : '扫描并补发',
    reason: limited ? `将按限定期历史数据扫描：${definition.historicalBasis}` : '将按当前真实业务数据扫描',
  }
}

function getAutoRuleError(draft: Pick<BadgeDraft, 'grantType' | 'legacyAuto' | 'seriesCompletionRule' | 'ruleType' | 'operator' | 'threshold' | 'ruleEnabled' | 'targetId'>) {
  if (draft.grantType !== 'AUTO' || draft.legacyAuto || draft.seriesCompletionRule) return null
  return parseBadgeRuleInput({
    ruleType: draft.ruleType,
    operator: draft.operator,
    threshold: isTargetRule(draft.ruleType) ? null : draft.threshold,
    configJson: draft.ruleType === 'CONCERT_SHOW_ATTENDED' ? { concertId: draft.targetId } : draft.ruleType === 'CONCERT_TOUR_ATTENDED' ? { tourId: draft.targetId } : draft.ruleType === 'ACTIVITY_PARTICIPATION' ? { activityId: draft.targetId } : undefined,
    isEnabled: draft.ruleEnabled,
  }).error || null
}

function formatDate(value: string) { return new Date(value).toLocaleDateString('zh-CN') }
function formatDateTimeInput(value: string | null) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return values.year ? `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}` : ''
}

export function BadgeAdminManager({ initialBadges }: { initialBadges: AdminBadge[] }) {
  const [badges, setBadges] = useState(initialBadges)
  const [draft, setDraft] = useState<BadgeDraft | null>(null)
  const [query, setQuery] = useState('')
  const [filterVisibility, setFilterVisibility] = useState('')
  const [filterEnabled, setFilterEnabled] = useState('')
  const [filterRarity, setFilterRarity] = useState('')
  const [filterGrantType, setFilterGrantType] = useState('')
  const [filterSeries, setFilterSeries] = useState('')
  const [filterAvailability, setFilterAvailability] = useState('')
  const [filterOrder, setFilterOrder] = useState('sortOrder')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [ownersBadge, setOwnersBadge] = useState<AdminBadge | null>(null)
  const [owners, setOwners] = useState<Array<{ id: string; obtainedAt: string; grantReason: string | null; user: { uid: number; displayName: string } }>>([])
  const [grantBadgeTarget, setGrantBadgeTarget] = useState<AdminBadge | null>(null)
  const [grantQuery, setGrantQuery] = useState('')
  const [grantUsers, setGrantUsers] = useState<Array<{ id: string; uid: number; displayName: string }>>([])
  const [grantUserId, setGrantUserId] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [grantConfirmed, setGrantConfirmed] = useState(false)
  const [grantUserStatus, setGrantUserStatus] = useState<{ user: { id: string; uid: number; displayName: string }; ownership: { owned: boolean; obtainedAt: string | null }; currentMetric: number | null; historicalMetric: number | null; rule: { threshold: number | null; historicalSupported: boolean; historicalBasis: string } | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [series, setSeries] = useState<AdminSeries[]>([])
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft | null>(null)
  const [preview, setPreview] = useState<AdminBadge | null>(null)
  const [previewData, setPreviewData] = useState<{ eligibleCount: number; ownedCount: number; pendingCount: number; availability: string; historical?: { supported: boolean; mode: string; basis: string; from: string | null; until: string | null; message: string | null } } | null>(null)
  const [formSections, setFormSections] = useState({ basic: true, rules: true, display: false })
  const [concertOptions, setConcertOptions] = useState<ConcertOption[]>([])
  const [tourOptions, setTourOptions] = useState<TourOption[]>([])
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([])
  const [concertSearch, setConcertSearch] = useState('')

  const visibleBadges = useMemo(() => badges.filter((badge) => {
    const matchesQuery = !query.trim() || badge.name.toLowerCase().includes(query.trim().toLowerCase())
    const matchesVisibility = !filterVisibility || badge.visibility === filterVisibility
    const matchesEnabled = !filterEnabled || (filterEnabled === 'true' ? badge.isEnabled : !badge.isEnabled)
    const matchesRarity = !filterRarity || badge.rarity === filterRarity
    const matchesGrantType = !filterGrantType || badge.grantType === filterGrantType
    const matchesSeries = !filterSeries || badge.seriesId === filterSeries
    const matchesAvailability = !filterAvailability || badge.availabilityStatus === filterAvailability
    return matchesQuery && matchesVisibility && matchesEnabled && matchesRarity && matchesGrantType && matchesSeries && matchesAvailability
  }), [badges, filterAvailability, filterEnabled, filterGrantType, filterRarity, filterSeries, filterVisibility, query])

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/admin/badges/series', { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { series?: AdminSeries[] } | null
      if (response.ok && data?.series) setSeries(data.series)
    })()
  }, [])

  useEffect(() => {
    void fetch('/api/music/concerts/options?kind=tours', { cache: 'no-store' }).then((response) => response.json()).then((data: { tours?: TourOption[] }) => setTourOptions(data.tours || [])).catch(() => undefined)
  }, [])

  useEffect(() => {
    void fetch('/api/admin/badges/activities', { cache: 'no-store' }).then((response) => response.json()).then((data: { activities?: ActivityOption[] }) => setActivityOptions(data.activities || [])).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!draft?.targetId || draft.targetLabel) return
    if (draft.ruleType === 'CONCERT_TOUR_ATTENDED') {
      const tour = tourOptions.find((item) => item.id === draft.targetId)
      if (tour) setDraft((current) => current?.targetId === tour.id ? { ...current, targetLabel: tour.name } : current)
    } else if (draft.ruleType === 'CONCERT_SHOW_ATTENDED') {
      void fetch(`/api/music/concerts/options?id=${encodeURIComponent(draft.targetId)}`, { cache: 'no-store' }).then((response) => response.json()).then((data: { concerts?: ConcertOption[] }) => {
        const concert = data.concerts?.find((item) => item.id === draft.targetId)
        if (concert) setDraft((current) => current?.targetId === concert.id ? { ...current, targetLabel: `${concert.MusicTour.name} · ${concert.city} · ${new Date(concert.concertDate).toLocaleDateString('zh-CN')}` } : current)
      }).catch(() => undefined)
    } else if (draft.ruleType === 'ACTIVITY_PARTICIPATION') {
      const activity = activityOptions.find((item) => item.id === draft.targetId)
      if (activity) setDraft((current) => current?.targetId === activity.id ? { ...current, targetLabel: activity.title } : current)
    }
  }, [activityOptions, draft?.ruleType, draft?.targetId, draft?.targetLabel, tourOptions])

  async function searchConcertOptions() {
    const value = concertSearch.trim()
    const params = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `date=${encodeURIComponent(value)}` : `q=${encodeURIComponent(value)}`
    const response = await fetch(`/api/music/concerts/options?${params}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { concerts?: ConcertOption[] } | null
    if (!response.ok || !data?.concerts) return fail('演唱会搜索失败')
    setConcertOptions(data.concerts)
  }

  async function reload(overrides: Partial<{ query: string; filterVisibility: string; filterEnabled: string; filterRarity: string; filterGrantType: string; filterSeries: string; filterAvailability: string; filterOrder: string }> = {}) {
    const params = new URLSearchParams()
    const nextQuery = overrides.query ?? query
    const nextVisibility = overrides.filterVisibility ?? filterVisibility
    const nextEnabled = overrides.filterEnabled ?? filterEnabled
    const nextRarity = overrides.filterRarity ?? filterRarity
    const nextGrantType = overrides.filterGrantType ?? filterGrantType
    const nextSeries = overrides.filterSeries ?? filterSeries
    const nextAvailability = overrides.filterAvailability ?? filterAvailability
    const nextOrder = overrides.filterOrder ?? filterOrder
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    if (nextVisibility) params.set('visibility', nextVisibility)
    if (nextEnabled) params.set('enabled', nextEnabled)
    if (nextRarity) params.set('rarity', nextRarity)
    if (nextGrantType) params.set('grantType', nextGrantType)
    if (nextSeries) params.set('seriesId', nextSeries)
    if (nextAvailability) params.set('availability', nextAvailability)
    if (nextOrder) params.set('order', nextOrder)
    const response = await fetch(`/api/admin/badges?${params}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { badges?: AdminBadge[]; message?: string } | null
    if (!response.ok || !data?.badges) throw new Error(data?.message || '勋章列表加载失败')
    setBadges(data.badges)
  }

  async function saveSeries(event: React.FormEvent) {
    event.preventDefault()
    if (!seriesDraft) return
    setBusy(true)
    try {
      const response = await fetch(seriesDraft.id ? `/api/admin/badges/series/${seriesDraft.id}` : '/api/admin/badges/series', {
        method: seriesDraft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seriesDraft),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '系列保存失败')
      const refreshed = await fetch('/api/admin/badges/series', { cache: 'no-store' })
      const refreshedData = await refreshed.json().catch(() => null) as { series?: AdminSeries[] } | null
      if (refreshed.ok && refreshedData?.series) setSeries(refreshedData.series)
      await reload()
      setSeriesDraft(null)
      notify(seriesDraft.id ? '勋章系列已更新' : '勋章系列已创建')
    } catch (seriesError) { fail(seriesError instanceof Error ? seriesError.message : '系列保存失败') } finally { setBusy(false) }
  }

  async function deleteSeries(item: AdminSeries) {
    if (!window.confirm(`确认删除系列「${item.name}」吗？其下勋章只会解除关联，不会删除。`)) return
    const response = await fetch(`/api/admin/badges/series/${item.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null) as { message?: string } | null
    if (!response.ok) return fail(data?.message || '系列删除失败')
    setSeries((current) => current.filter((seriesItem) => seriesItem.id !== item.id))
    notify('系列已删除，勋章已解除系列关联')
    await reload()
  }

  function notify(nextMessage: string) { setMessage(nextMessage); setError('') }
  function fail(nextError: string) { setError(nextError); setMessage('') }

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    const ruleError = getAutoRuleError(draft)
    if (ruleError) {
      setFormSections((current) => ({ ...current, rules: true }))
      return fail(ruleError)
    }
    const ruleChanged = Boolean(
      draft.id && draft.rule && draft.grantType === 'AUTO' && !draft.legacyAuto && !draft.seriesCompletionRule && (
        draft.rule.ruleType !== draft.ruleType ||
        draft.rule.operator !== draft.operator ||
        draft.rule.threshold !== draft.threshold ||
        (isTargetRule(draft.ruleType) && (typeof (draft.rule.configJson as { concertId?: unknown; tourId?: unknown; activityId?: unknown } | null)?.concertId === 'string' ? String((draft.rule.configJson as { concertId: string }).concertId) : typeof (draft.rule.configJson as { tourId?: unknown } | null)?.tourId === 'string' ? String((draft.rule.configJson as { tourId: string }).tourId) : typeof (draft.rule.configJson as { activityId?: unknown } | null)?.activityId === 'string' ? String((draft.rule.configJson as { activityId: string }).activityId) : '') !== draft.targetId) ||
        draft.rule.isEnabled !== draft.ruleEnabled
      ),
    )
    if (ruleChanged && !window.confirm('规则修改不会撤销已获得用户的历史勋章；保存后，新规则将用于后续自动授予。确定继续吗？')) return
    setBusy(true)
    try {
      const response = await fetch(draft.id ? `/api/admin/badges/${draft.id}` : '/api/admin/badges', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          // The legacy enum is retained server-side, but the admin surface now
          // sends only the new enabled + shine-color semantics.
          nicknameEffect: draft.nicknameEffect !== 'NONE' ? 'COLOR' : 'NONE',
          nicknameColor: draft.nicknameEffect !== 'NONE' ? draft.nicknameColor || BADGE_NICKNAME_SHINE_FALLBACK : null,
          imageUrl: draft.imageUrl || draft.iconUrl || null,
          rule: draft.grantType === 'AUTO' && !draft.legacyAuto
            ? draft.seriesCompletionRule
              ? { ruleType: 'BADGE_SERIES_COMPLETE', operator: 'GTE', threshold: null, configJson: draft.rule?.configJson, isEnabled: draft.ruleEnabled }
              : { ruleType: draft.ruleType, operator: draft.operator, threshold: isTargetRule(draft.ruleType) ? null : draft.threshold, configJson: draft.ruleType === 'CONCERT_SHOW_ATTENDED' ? { concertId: draft.targetId } : draft.ruleType === 'CONCERT_TOUR_ATTENDED' ? { tourId: draft.targetId } : draft.ruleType === 'ACTIVITY_PARTICIPATION' ? { activityId: draft.targetId } : undefined, isEnabled: draft.ruleEnabled }
            : null,
        }),
      })
      const data = await response.json().catch(() => null) as { badge?: AdminBadge; message?: string } | null
      if (!response.ok || !data?.badge) throw new Error(data?.message || '保存失败')
      setDraft(null)
      notify(draft.id ? '勋章已更新' : '勋章已创建')
      await reload()
    } catch (saveError) {
      setFormSections({ basic: true, rules: true, display: true })
      fail(saveError instanceof Error ? saveError.message : '保存失败')
    } finally { setBusy(false) }
  }

  async function backfillBadge(badge: AdminBadge) {
    if (badge.grantType !== 'AUTO' || !badge.rule) return
    if (!badge.rule.isEnabled) return fail('自动规则当前未启用，不能补发')
    const backfillState = getBackfillUiState(badge)
    if (backfillState.disabled) return fail(backfillState.reason)
    const period = badge.availableFrom || badge.availableUntil ? `扫描限定期历史数据（${badge.availableFrom ? formatDate(badge.availableFrom) : '最早记录'} 至 ${badge.availableUntil ? formatDate(badge.availableUntil) : '现在'}）。` : ''
    if (!window.confirm(`将为${period}当前符合「${badge.name}」规则但尚未拥有的用户补发勋章。该操作不会撤销任何历史勋章。确认继续吗？`)) return
    setBusy(true)
    try {
      let cursor: string | undefined
      let granted = 0
      let scanned = 0
      let done = false
      do {
        const response = await fetch(`/api/admin/badges/${badge.id}/backfill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor, batchSize: 200 }),
        })
        const data = await response.json().catch(() => null) as { summary?: { granted: number; scanned: number; nextCursor: string | null; done: boolean }; message?: string } | null
        if (!response.ok || !data?.summary) throw new Error(data?.message || '自动补发失败')
        granted += data.summary.granted
        scanned += data.summary.scanned
        cursor = data.summary.nextCursor || undefined
        done = data.summary.done
      } while (!done)
      notify(`已完成「${badge.name}」自动补发：扫描 ${scanned} 人，新增 ${granted} 枚`)
      await reload()
    } catch (backfillError) { fail(backfillError instanceof Error ? backfillError.message : '自动补发失败') } finally { setBusy(false) }
  }

  async function previewBadgeRule(badge: AdminBadge) {
    setPreview(badge)
    setPreviewData(null)
    const response = await fetch(`/api/admin/badges/${badge.id}/preview`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { preview?: { eligibleCount: number; ownedCount: number; pendingCount: number; availability: string; historical?: { supported: boolean; mode: string; basis: string; from: string | null; until: string | null; message: string | null } }; message?: string } | null
    if (!response.ok || !data?.preview) return fail(data?.message || '规则预览失败')
    setPreviewData(data.preview)
  }

  function previewSavedDraft() {
    if (!draft?.id) return fail('请先保存勋章，再预览已保存的自动规则')
    const savedBadge = badges.find((badge) => badge.id === draft.id)
    if (!savedBadge) return fail('勋章列表已更新，请关闭编辑后重新打开')
    void previewBadgeRule(savedBadge)
  }

  function backfillSavedDraft() {
    if (!draft?.id) return fail('请先保存勋章，再执行自动补发')
    const savedBadge = badges.find((badge) => badge.id === draft.id)
    if (!savedBadge) return fail('勋章列表已更新，请关闭编辑后重新打开')
    void backfillBadge(savedBadge)
  }

  async function uploadBadgeImage(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/admin/badges/upload', { method: 'POST', body: form })
      const data = await response.json().catch(() => null) as { url?: string; message?: string } | null
      if (!response.ok || !data?.url) throw new Error(data?.message || '图片上传失败')
      setDraft((current) => current ? { ...current, iconUrl: data.url || null, imageUrl: data.url || null } : current)
      notify('勋章图片已上传，保存后正式关联')
    } catch (uploadError) { fail(uploadError instanceof Error ? uploadError.message : '图片上传失败') } finally { setUploading(false) }
  }

  async function toggleBadge(badge: AdminBadge) {
    try {
      const response = await fetch(`/api/admin/badges/${badge.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isEnabled: !badge.isEnabled }) })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '状态更新失败')
      notify(badge.isEnabled ? '勋章已停用，当前佩戴已自动取消' : '勋章已启用')
      await reload()
    } catch (toggleError) { fail(toggleError instanceof Error ? toggleError.message : '状态更新失败') }
  }

  async function deleteBadge(badge: AdminBadge) {
    if (!window.confirm(`确认删除「${badge.name}」吗？已有用户获得时会被阻止删除。`)) return
    const response = await fetch(`/api/admin/badges/${badge.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null) as { message?: string } | null
    if (!response.ok) return fail(data?.message || '删除失败')
    notify('勋章已删除')
    await reload()
  }

  async function loadOwners(badge: AdminBadge) {
    setOwnersBadge(badge)
    const response = await fetch(`/api/admin/badges/${badge.id}/owners`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { owners?: typeof owners; message?: string } | null
    if (!response.ok || !data?.owners) return fail(data?.message || '获得用户加载失败')
    setOwners(data.owners)
  }

  async function searchGrantUsers() {
    if (!grantQuery.trim()) return setGrantUsers([])
    const response = await fetch(`/api/admin/badges/users?q=${encodeURIComponent(grantQuery.trim())}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { users?: typeof grantUsers; message?: string } | null
    if (!response.ok || !data?.users) return fail(data?.message || '用户搜索失败')
    setGrantUsers(data.users)
  }

  async function selectGrantUser(user: { id: string; uid: number; displayName: string }) {
    setGrantUserId(user.id)
    setGrantConfirmed(false)
    setGrantUserStatus(null)
    if (!grantBadgeTarget) return
    const response = await fetch(`/api/admin/badges/${grantBadgeTarget.id}/grant?userId=${encodeURIComponent(user.id)}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { user?: typeof user; ownership?: { owned: boolean; obtainedAt: string | null }; currentMetric?: number | null; historicalMetric?: number | null; rule?: { threshold: number | null; historicalSupported: boolean; historicalBasis: string } | null; message?: string } | null
    if (!response.ok || !data?.user || !data.ownership) return fail(data?.message || '用户勋章状态加载失败')
    setGrantUserStatus({ user: data.user, ownership: data.ownership, currentMetric: data.currentMetric ?? null, historicalMetric: data.historicalMetric ?? null, rule: data.rule ? { threshold: data.rule.threshold, historicalSupported: data.rule.historicalSupported, historicalBasis: data.rule.historicalBasis } : null })
  }

  async function grantSelected() {
    if (!grantBadgeTarget || !grantUserId) return fail('请选择目标用户')
    const limited = Boolean(grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil)
    if (limited && !grantReason.trim()) return fail('限定勋章手动补发必须填写补发原因')
    if (grantUserStatus?.ownership.owned) return fail('该用户已经拥有此勋章，不能重复补发')
    if (limited && !grantConfirmed) return fail('请先确认已核实该用户在限定时间内符合条件')
    if (limited && !window.confirm(`确定补发「${grantBadgeTarget.name}」给「${grantUserStatus?.user.displayName || grantUserId}」吗？\n\n限定期：${grantBadgeTarget.availableFrom ? formatDate(grantBadgeTarget.availableFrom) : '最早记录'} 至 ${grantBadgeTarget.availableUntil ? formatDate(grantBadgeTarget.availableUntil) : '现在'}\n补发原因：${grantReason.trim()}`)) return
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/badges/${grantBadgeTarget.id}/grant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: grantUserId, grantReason, sourceType: limited ? 'ADMIN_BACKFILL' : 'MANUAL' }) })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '发放失败')
      notify('勋章已发放并记录管理员操作日志')
      setGrantBadgeTarget(null)
      setGrantUserStatus(null)
      await reload()
    } catch (grantError) { fail(grantError instanceof Error ? grantError.message : '发放失败') } finally { setBusy(false) }
  }

  async function revokeOwner(owner: (typeof owners)[number]) {
    if (!ownersBadge) return
    if (!window.confirm(`确认收回 ${owner.user.displayName} 的「${ownersBadge.name}」吗？`)) return
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/badges/${ownersBadge.id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: owner.user.uid, reason: '管理员在勋章管理中收回' }),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '收回失败')
      setOwners((current) => current.filter((item) => item.id !== owner.id))
      notify('勋章已收回，若正在佩戴也已同步取消')
      await reload()
    } catch (revokeError) { fail(revokeError instanceof Error ? revokeError.message : '收回失败') } finally { setBusy(false) }
  }

  const savedDraftBadge = draft?.id ? badges.find((badge) => badge.id === draft.id) || null : null
  const savedDraftBackfill = savedDraftBadge?.rule ? getBackfillUiState(savedDraftBadge) : null
  const nicknamePreviewBadge = draft ? {
    id: 'admin-nickname-preview',
    name: draft.name || '勋章预览',
    imageUrl: null,
    effectType: 'NONE' as const,
    nicknameEffect: draft.nicknameEffect,
    nicknameColor: draft.nicknameColor || BADGE_NICKNAME_SHINE_FALLBACK,
    nicknameGradientStart: null,
    nicknameGradientEnd: null,
  } : null

  return (
    <div className="space-y-5">
      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
      <section className="rounded-[24px] border border-violet-100 bg-violet-50/60 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Badge series</p><h2 className="mt-1 text-lg font-black text-brand-950">勋章系列</h2><p className="mt-1 text-xs font-bold text-slate-500">系列内部标识由系统自动生成；停用不会删除勋章或历史荣誉。</p></div><button type="button" onClick={() => setSeriesDraft({ name: '', description: '', sortOrder: 0, isEnabled: true, completionRewardBadgeId: null })} className="rounded-xl bg-brand-950 px-3 py-2 text-xs font-black text-white">新建系列</button></div>
         {seriesDraft ? <form onSubmit={saveSeries} className="mt-4 grid gap-2 rounded-2xl border border-violet-100 bg-white p-3 sm:grid-cols-[1.2fr_1fr_100px_1.4fr_auto_auto] sm:items-end"><label className="text-[11px] font-black text-slate-500">系列名称<input required value={seriesDraft.name} onChange={(event) => setSeriesDraft({ ...seriesDraft, name: event.target.value })} className="admin-badge-input" /></label><label className="text-[11px] font-black text-slate-500">简介<input value={seriesDraft.description} onChange={(event) => setSeriesDraft({ ...seriesDraft, description: event.target.value })} className="admin-badge-input" /></label><label className="text-[11px] font-black text-slate-500">排序<input type="number" value={seriesDraft.sortOrder} onChange={(event) => setSeriesDraft({ ...seriesDraft, sortOrder: Number(event.target.value) })} className="admin-badge-input" /></label><label className="text-[11px] font-black text-slate-500">系列完成奖励<select value={seriesDraft.completionRewardBadgeId || ''} onChange={(event) => setSeriesDraft({ ...seriesDraft, completionRewardBadgeId: event.target.value || null })} className="admin-badge-input"><option value="">不设置奖励</option>{badges.filter((badge) => badge.isEnabled && badge.grantType === 'AUTO' && (badge.id === seriesDraft.completionRewardBadgeId || !seriesDraft.id || badge.seriesId !== seriesDraft.id || !badge.tierGroupCode)).map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}</select><span className="mt-1 block text-[10px] font-bold text-slate-400">奖励必须是启用的自动勋章。</span></label><label className="flex items-center gap-2 pb-2 text-[11px] font-black text-brand-950"><input type="checkbox" checked={seriesDraft.isEnabled} onChange={(event) => setSeriesDraft({ ...seriesDraft, isEnabled: event.target.checked })} />启用</label><div className="flex gap-2"><button type="submit" disabled={busy} className="rounded-xl bg-brand-950 px-3 py-2 text-xs font-black text-white">保存</button><button type="button" onClick={() => setSeriesDraft(null)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">取消</button></div></form> : null}
        {series.length ? <div className="mt-3 flex flex-wrap gap-2">{series.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-2 text-xs font-black text-brand-950"><span>{item.name}</span><span className="text-slate-400">{item._count?.Badges ?? '—'} 枚</span><span className={item.isEnabled ? 'text-emerald-600' : 'text-slate-400'}>{item.isEnabled ? '启用' : '停用'}</span>{item.completionRewardBadgeId ? <span className="text-amber-700">有完成奖励</span> : null}<button type="button" onClick={() => setSeriesDraft({ id: item.id, name: item.name, description: item.description || '', sortOrder: item.sortOrder, isEnabled: item.isEnabled, completionRewardBadgeId: item.completionRewardBadgeId })} className="text-brand-700">编辑</button><button type="button" onClick={() => void deleteSeries(item)} className="text-red-600">删除</button></div>)}</div> : <p className="mt-3 text-xs font-bold text-slate-500">还没有系列；历史勋章可以继续保持未分类。</p>}
      </section>
      <section className="rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1 text-xs font-black text-slate-500">搜索勋章<input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void reload() }} placeholder="输入勋章名称" className="mt-1 min-h-10 w-full rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950" /></label>
          <label className="text-xs font-black text-slate-500">状态<select value={filterEnabled} onChange={(event) => { const value = event.target.value; setFilterEnabled(value); void reload({ filterEnabled: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部</option><option value="true">启用</option><option value="false">停用</option></select></label>
          <label className="text-xs font-black text-slate-500">可见性<select value={filterVisibility} onChange={(event) => { const value = event.target.value; setFilterVisibility(value); void reload({ filterVisibility: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部</option>{Object.entries(BADGE_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">稀有度<select value={filterRarity} onChange={(event) => { const value = event.target.value; setFilterRarity(value); void reload({ filterRarity: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部稀有度</option>{Object.entries(BADGE_RARITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">发放类型<select value={filterGrantType} onChange={(event) => { const value = event.target.value; setFilterGrantType(value); void reload({ filterGrantType: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部发放</option>{Object.entries(BADGE_GRANT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">系列<select value={filterSeries} onChange={(event) => { const value = event.target.value; setFilterSeries(value); void reload({ filterSeries: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部系列</option>{series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">限定<select value={filterAvailability} onChange={(event) => { const value = event.target.value; setFilterAvailability(value); void reload({ filterAvailability: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部状态</option><option value="PERMANENT">永久</option><option value="UPCOMING">即将开放</option><option value="AVAILABLE">可获得</option><option value="ENDED">已绝版</option></select></label>
          <label className="text-xs font-black text-slate-500">排序<select value={filterOrder} onChange={(event) => { const value = event.target.value; setFilterOrder(value); void reload({ filterOrder: value }) }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="sortOrder">展示顺序</option><option value="ownerCount">获得人数</option><option value="rate">获得率</option><option value="createdAt">创建时间</option></select></label>
          <button type="button" onClick={() => { setFormSections({ basic: true, rules: true, display: false }); setDraft({ ...emptyDraft }) }} className="min-h-10 rounded-xl bg-brand-950 px-4 text-sm font-black text-white">新增勋章</button>
        </div>
      </section>

      {draft ? <form onSubmit={saveDraft} className="rounded-[24px] border border-sky-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">{draft.id ? '编辑勋章' : '新增勋章'}</h2><button type="button" onClick={() => setDraft(null)} className="text-sm font-black text-slate-500">取消</button></div>
        <details open={formSections.basic} onToggle={(event) => { const open = event.currentTarget.open; setFormSections((current) => current.basic === open ? current : { ...current, basic: open }) }} className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/60 p-3"><summary className="cursor-pointer list-none text-sm font-black text-brand-950">基础信息与收藏设置</summary><p className="mt-1 text-[11px] font-bold text-slate-500">系列、成长等级、限定时间和获取说明决定这枚勋章如何被收藏与展示。</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-black text-slate-500">勋章名称<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="admin-badge-input" /></label>
          <div className="text-xs font-black text-slate-500 md:col-span-2"><span>勋章图片</span><div className="mt-2 flex flex-wrap items-center gap-3">{draft.imageUrl || draft.iconUrl ? <img src={draft.imageUrl || draft.iconUrl || ''} alt="勋章图片预览" className="h-24 w-24 object-contain" /> : <div className="grid h-24 w-24 place-items-center rounded-xl border border-dashed border-sky-200 text-2xl">🏅</div>}<div><label className="inline-flex cursor-pointer rounded-xl bg-brand-950 px-4 py-2 text-xs font-black text-white">{draft.imageUrl || draft.iconUrl ? '更换图片' : '+ 上传 PNG / WebP'}<input type="file" accept="image/png,image/webp,.png,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBadgeImage(file) }} className="sr-only" /></label>{draft.imageUrl || draft.iconUrl ? <button type="button" onClick={() => setDraft({ ...draft, imageUrl: null, iconUrl: null })} className="ml-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">删除</button> : null}<p className="mt-2 text-[11px] font-bold text-slate-400">{uploading ? '上传中…' : '支持透明 PNG / WebP，最大 2MB，不会转换成 JPEG'}</p></div></div></div>
          <label className="text-xs font-black text-slate-500">排序<input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className="admin-badge-input" /></label>
          <label className="text-xs font-black text-slate-500">勋章类型<select value={draft.badgeType} onChange={(event) => { const badgeType = event.target.value as BadgeDraft['badgeType']; setDraft({ ...draft, badgeType, seriesId: badgeType === 'STANDARD' ? null : draft.seriesId, series: badgeType === 'STANDARD' ? null : draft.series, tierEnabled: badgeType === 'STANDARD' ? false : draft.tierEnabled, tierLevel: badgeType === 'STANDARD' ? null : draft.tierLevel, legacyTier: false }) }} className="admin-badge-input"><option value="STANDARD">普通勋章</option><option value="SERIES">系列勋章</option></select></label>
          <label className="text-xs font-black text-slate-500">所属系列<div className="flex gap-2"><select value={draft.seriesId || ''} onChange={(event) => { const seriesId = event.target.value || null; setDraft({ ...draft, badgeType: seriesId || draft.tierEnabled ? 'SERIES' : 'STANDARD', seriesId, series: null, legacyTier: false }) }} className="admin-badge-input"><option value="">不加入系列</option>{series.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isEnabled ? '' : '（停用）'}</option>)}</select><button type="button" onClick={() => setSeriesDraft({ name: '', description: '', sortOrder: series.length * 10, isEnabled: true, completionRewardBadgeId: null })} className="shrink-0 rounded-xl bg-violet-100 px-3 text-xs font-black text-violet-800">新建系列</button></div></label>
          <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 md:col-span-2"><label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.tierEnabled} onChange={(event) => setDraft({ ...draft, badgeType: event.target.checked || draft.seriesId ? 'SERIES' : 'STANDARD', tierEnabled: event.target.checked, tierLevel: event.target.checked ? (draft.tierLevel || 1) : null })} />这是成长型分级勋章</label>{draft.legacyTier && !draft.seriesId ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">这是旧版成长勋章，系统会保留原有配置；如需迁移，请选择成长系列。</p> : null}{draft.tierEnabled ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-black text-slate-500">成长系列<select required={!draft.legacyTier} value={draft.seriesId || ''} onChange={(event) => setDraft({ ...draft, badgeType: 'SERIES', seriesId: event.target.value || null, series: null, legacyTier: false })} className="admin-badge-input"><option value="">请选择成长系列</option>{series.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isEnabled ? '' : '（停用）'}</option>)}</select></label><label className="text-xs font-black text-slate-500">等级 / 阶段<select value={draft.tierLevel || 1} onChange={(event) => setDraft({ ...draft, tierLevel: Number(event.target.value) })} className="admin-badge-input">{Array.from({ length: 99 }, (_, index) => index + 1).map((level) => <option key={level} value={level}>{level}级</option>)}</select></label></div> : <p className="mt-2 text-xs font-bold text-slate-500">普通勋章不参与成长等级；系统会保存为空。</p>}</div>
          <label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.limitedEnabled} onChange={(event) => setDraft({ ...draft, limitedEnabled: event.target.checked, availableFrom: event.target.checked ? draft.availableFrom : null, availableUntil: event.target.checked ? draft.availableUntil : null })} />限定时间（上海时间）</label>
          {draft.limitedEnabled ? <><label className="text-xs font-black text-slate-500">限定开始（上海时间）<input type="datetime-local" value={formatDateTimeInput(draft.availableFrom)} onChange={(event) => setDraft({ ...draft, availableFrom: event.target.value || null })} className="admin-badge-input" /></label><label className="text-xs font-black text-slate-500">限定结束（上海时间）<input type="datetime-local" value={formatDateTimeInput(draft.availableUntil)} onChange={(event) => setDraft({ ...draft, availableFrom: draft.availableFrom, availableUntil: event.target.value || null })} className="admin-badge-input" /></label></> : null}
          <label className="text-xs font-black text-slate-500 md:col-span-2">勋章简介<textarea value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="admin-badge-input min-h-20" /></label>
          <label className="text-xs font-black text-slate-500 md:col-span-2">获取方式说明<textarea value={draft.acquisitionDescription || ''} onChange={(event) => { const value = event.target.value; const generated = defaultAcquisitionDescription(draft); setDraft({ ...draft, acquisitionDescription: value, acquisitionDescriptionCustomized: draft.grantType === 'AUTO' && !draft.legacyAuto ? value.trim() !== generated : false }) }} className="admin-badge-input min-h-20" /><span className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-400"><span>{draft.legacyAuto ? '旧业务事件徽章沿用现有获取逻辑' : draft.grantType === 'AUTO' ? (draft.acquisitionDescriptionCustomized ? '当前为自定义文案，修改规则时保留' : '规则变化时自动跟随默认文案') : '仅用于前台展示，不参与自动授予判断'}</span>{draft.grantType === 'AUTO' && !draft.legacyAuto && draft.acquisitionDescriptionCustomized ? <button type="button" onClick={() => setDraft({ ...draft, acquisitionDescription: defaultAcquisitionDescription(draft), acquisitionDescriptionCustomized: false })} className="font-black text-brand-700">恢复默认文案</button> : null}</span></label>
          <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3 md:col-span-2"><p className="text-xs font-black text-amber-800">展示效果</p><label className="mt-2 block text-xs font-black text-slate-500">闪光效果<select value={draft.effectType} onChange={(event) => setDraft({ ...draft, effectType: event.target.value as BadgeEffectType })} className="admin-badge-input">{Object.entries(BADGE_EFFECT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="mt-2 text-[11px] font-bold text-slate-400">仅改变勋章的视觉表现，不影响授予条件；减少动态模式下会自动停止动画。</p></div>
        </div></details>
        <details open={formSections.rules} onToggle={(event) => { const open = event.currentTarget.open; setFormSections((current) => current.rules === open ? current : { ...current, rules: open }) }} className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/60 p-3"><summary className="cursor-pointer list-none text-sm font-black text-brand-950">获取规则</summary><p className="mt-1 text-[11px] font-bold text-slate-500">MANUAL 只保留说明；EVENT 由生日、演唱会等业务事件处理；AUTO 才会显示结构化规则。</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-black text-slate-500">可见性<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as BadgeVisibility })} className="admin-badge-input">{Object.entries(BADGE_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">稀有度<select value={draft.rarity} onChange={(event) => setDraft({ ...draft, rarity: event.target.value as BadgeRarity })} className="admin-badge-input">{Object.entries(BADGE_RARITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">发放类型<select value={draft.grantType} onChange={(event) => { const grantType = event.target.value as BadgeGrantType; setDraft((current) => { if (!current) return current; const next = { ...current, grantType, legacyAuto: grantType === 'AUTO' ? current.legacyAuto : false }; return grantType === 'AUTO' && !next.legacyAuto ? { ...next, acquisitionDescription: next.acquisitionDescriptionCustomized ? next.acquisitionDescription : defaultAcquisitionDescription(next), acquisitionDescriptionCustomized: next.acquisitionDescriptionCustomized && current.grantType === 'AUTO' } : next }) }} className="admin-badge-input">{Object.entries(BADGE_GRANT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {draft.grantType === 'AUTO' && draft.legacyAuto ? <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 md:col-span-2"><p className="text-sm font-black text-amber-900">这是旧业务自动徽章，当前没有结构化规则，生日等现有事件服务仍会继续管理它。</p><p className="mt-1 text-xs font-bold text-amber-800">如需改成按统计条件自动授予，请显式启用结构化规则；这不会撤销历史 UserBadge。</p><button type="button" onClick={() => setDraft({ ...draft, legacyAuto: false, acquisitionDescription: draft.acquisitionDescriptionCustomized ? draft.acquisitionDescription : defaultAcquisitionDescription({ ...draft, legacyAuto: false }) })} className="mt-3 rounded-xl bg-amber-900 px-3 py-2 text-xs font-black text-white">启用结构化规则</button></div> : null}
          {draft.grantType === 'AUTO' && draft.seriesCompletionRule ? <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 md:col-span-2"><p className="text-sm font-black text-amber-900">这是系列完成奖励勋章，结构化条件由“勋章系列”管理。</p><p className="mt-1 text-xs font-bold text-amber-800">当前规则：{BADGE_RULE_TYPE_LABELS.BADGE_SERIES_COMPLETE}。如需更换或解除奖励，请在上方系列设置中操作；不会自动撤销历史 UserBadge。</p><label className="mt-3 flex items-center gap-2 text-xs font-black text-amber-900"><input type="checkbox" checked={draft.ruleEnabled} onChange={(event) => setDraft({ ...draft, ruleEnabled: event.target.checked })} />启用系列奖励规则</label></div> : null}
          {draft.grantType === 'AUTO' && !draft.legacyAuto && !draft.seriesCompletionRule ? (
            <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4 md:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-brand-950">自动获得条件</p><p className="mt-1 text-xs font-bold text-slate-500">选择条件并填写中文参数，系统会按真实业务数据判断。</p></div><label className="flex items-center gap-2 text-xs font-black text-brand-950"><input type="checkbox" checked={draft.ruleEnabled} onChange={(event) => setDraft({ ...draft, ruleEnabled: event.target.checked })} />启用规则</label></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-black text-slate-500">获得规则<select value={draft.ruleType} onChange={(event) => { const ruleType = event.target.value as SupportedBadgeRuleType; setDraft((current) => { if (!current) return current; const next = { ...current, ruleType, targetId: '', targetLabel: '' }; return next.acquisitionDescriptionCustomized ? next : { ...next, acquisitionDescription: defaultAcquisitionDescription(next) } }) }} className="admin-badge-input">{RULE_GROUPS.map((group) => <optgroup key={group} label={group}>{BADGE_ADMIN_RULE_TYPES.filter((value) => BADGE_RULE_REGISTRY[value].group === group).map((value) => <option key={value} value={value}>{BADGE_RULE_TYPE_LABELS[value]}</option>)}</optgroup>)}</select></label>
                {!isTargetRule(draft.ruleType) ? <label className="text-xs font-black text-slate-500">需要达到<div className="flex items-center gap-2"><input type="number" min="1" max="1000000000" value={draft.threshold} onChange={(event) => { const threshold = Number(event.target.value); setDraft((current) => { if (!current) return current; const next = { ...current, threshold: Number.isFinite(threshold) ? threshold : 1 }; return next.acquisitionDescriptionCustomized ? next : { ...next, acquisitionDescription: defaultAcquisitionDescription(next) } }) }} className="admin-badge-input" /><span className="text-sm font-black text-brand-950">{getRuleUnit(draft.ruleType)}</span></div></label> : null}
                {draft.ruleType === 'CONCERT_SHOW_ATTENDED' ? <div className="sm:col-span-2"><label className="text-xs font-black text-slate-500">选择演唱会<div className="mt-1 flex gap-2"><input value={concertSearch} onChange={(event) => setConcertSearch(event.target.value)} placeholder="搜索巡演、城市、场次或日期" className="admin-badge-input" /><button type="button" onClick={() => void searchConcertOptions()} className="shrink-0 rounded-xl bg-brand-950 px-4 text-xs font-black text-white">搜索</button></div></label><div className="mt-2 max-h-48 space-y-1 overflow-auto">{concertOptions.map((concert) => { const label = `${concert.MusicTour.name} · ${concert.city} · ${new Date(concert.concertDate).toLocaleDateString('zh-CN')}`; return <button key={concert.id} type="button" onClick={() => setDraft((current) => current ? { ...current, targetId: concert.id, targetLabel: label, acquisitionDescription: current.acquisitionDescriptionCustomized ? current.acquisitionDescription : `观看「${label}」后获得` } : current)} className={`block w-full rounded-xl px-3 py-2 text-left text-xs font-bold ${draft.targetId === concert.id ? 'bg-brand-950 text-white' : 'bg-white text-brand-950'}`}>{label}</button> })}</div>{draft.targetId ? <p className="mt-2 text-xs font-black text-emerald-700">已选择：{draft.targetLabel || '当前已保存演唱会'}</p> : null}</div> : null}
                {draft.ruleType === 'CONCERT_TOUR_ATTENDED' ? <label className="text-xs font-black text-slate-500 sm:col-span-2">选择巡演<select required value={draft.targetId} onChange={(event) => { const selected = tourOptions.find((tour) => tour.id === event.target.value); setDraft((current) => current ? { ...current, targetId: event.target.value, targetLabel: selected?.name || '', acquisitionDescription: current.acquisitionDescriptionCustomized ? current.acquisitionDescription : selected ? `观看「${selected.name}」巡演任意一场后获得` : '' } : current) }} className="admin-badge-input"><option value="">请选择巡演</option>{tourOptions.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label> : null}
                {draft.ruleType === 'ACTIVITY_PARTICIPATION' ? <label className="text-xs font-black text-slate-500 sm:col-span-2">选择活动<select required value={draft.targetId} onChange={(event) => { const selected = activityOptions.find((activity) => activity.id === event.target.value); setDraft((current) => current ? { ...current, targetId: event.target.value, targetLabel: selected?.title || '', acquisitionDescription: current.acquisitionDescriptionCustomized ? current.acquisitionDescription : selected ? `参加「${selected.title}」后获得` : '' } : current) }} className="admin-badge-input"><option value="">请选择活动</option>{activityOptions.map((activity) => <option key={activity.id} value={activity.id}>{activity.title} · {activity.status === 'PUBLISHED' ? '已发布' : activity.status === 'DRAFT' ? '草稿' : '已取消'} · {activity.startsAt ? new Date(activity.startsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未设置开始时间'}</option>)}</select>{draft.targetId ? <span className="mt-1 block text-[11px] font-black text-emerald-700">已选择：{draft.targetLabel || '当前已保存活动'}；只有有效人工 / 二维码现场核销才算参加，活动结束自动核销不计入。</span> : null}</label> : null}
              </div>
              <p className="mt-2 text-xs font-bold text-violet-700">数据口径：{BADGE_RULE_TYPE_DESCRIPTIONS[draft.ruleType]}</p>
            </div>
          ) : null}
          {draft.grantType === 'AUTO' && !draft.legacyAuto ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white p-3 md:col-span-2"><div><p className="text-xs font-black text-violet-800">规则操作</p><p className="mt-1 text-[11px] font-bold text-slate-500">预览只读；补发只处理符合条件且尚未拥有的用户，且需要先保存。限定勋章只按可证明的限定期数据扫描。</p>{getAutoRuleError(draft) ? <p className="mt-1 text-xs font-black text-red-600">{getAutoRuleError(draft)}</p> : null}{savedDraftBackfill ? <p className="mt-1 text-[11px] font-bold text-slate-500">{savedDraftBackfill.reason}</p> : null}</div><div className="flex flex-wrap gap-2"><button type="button" aria-label="预览已保存规则" title="预览已保存规则" disabled={busy || !draft.id || Boolean(getAutoRuleError(draft))} onClick={previewSavedDraft} className="admin-badge-list-button disabled:opacity-50">{draft.id ? '预览达标用户' : '保存后预览'}</button><button type="button" disabled={busy || !draft.id || !draft.ruleEnabled || Boolean(getAutoRuleError(draft)) || !savedDraftBackfill || savedDraftBackfill.disabled} onClick={backfillSavedDraft} className="admin-badge-list-button disabled:opacity-50">{draft.id ? savedDraftBackfill?.label || '暂不可扫描' : '保存后扫描'}</button></div></div> : null}
        </div></details>
        <details open={formSections.display} onToggle={(event) => { const open = event.currentTarget.open; setFormSections((current) => current.display === open ? current : { ...current, display: open }) }} className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3"><summary className="cursor-pointer list-none text-sm font-black text-brand-950">展示设置与状态</summary><p className="mt-1 text-[11px] font-bold text-slate-500">勋章动画、昵称闪光、PNG、可佩戴和启用状态只影响展示与可用性，不改变历史获得记录。</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-amber-100 bg-white/75 p-3 md:col-span-2"><label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.nicknameEffect !== 'NONE'} onChange={(event) => setDraft({ ...draft, nicknameEffect: event.target.checked ? 'COLOR' : 'NONE', nicknameColor: event.target.checked ? draft.nicknameColor || BADGE_NICKNAME_SHINE_FALLBACK : '' })} />昵称闪光</label><p className="mt-1 text-[11px] font-bold text-slate-500">仅在闪光带经过时显示，不会改变昵称原本颜色。</p></div>
          {draft.nicknameEffect !== 'NONE' ? <label className="text-xs font-black text-slate-500">昵称闪光颜色<input type="color" value={draft.nicknameColor || BADGE_NICKNAME_SHINE_FALLBACK} onChange={(event) => setDraft({ ...draft, nicknameColor: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-sky-200 p-1" /></label> : null}
          <label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.isWearable} onChange={(event) => setDraft({ ...draft, isWearable: event.target.checked })} />允许用户佩戴</label>
          <label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.isEnabled} onChange={(event) => setDraft({ ...draft, isEnabled: event.target.checked })} />启用勋章</label>
          <label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.countsTowardSeriesCompletion} onChange={(event) => setDraft({ ...draft, countsTowardSeriesCompletion: event.target.checked })} />计入系列完成度</label>
          <label className="flex items-center gap-2 text-sm font-black text-brand-950 md:col-span-2"><input type="checkbox" checked={draft.announceOnGrant} onChange={(event) => setDraft({ ...draft, announceOnGrant: event.target.checked })} />获得时发布好友动态 <span className="text-xs font-bold text-slate-400">SECRET 不会自动广播</span></label>
        </div></details>
        <section className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/60 p-4"><p className="text-xs font-black text-amber-800">勋章预览</p><div className="mt-3 flex items-center gap-4">{draft.imageUrl || draft.iconUrl ? <BadgeImage badge={{ name: draft.name || '勋章预览', imageUrl: draft.imageUrl || draft.iconUrl, effectType: draft.effectType }} size="detail" /> : <div className="grid h-20 w-20 place-items-center text-3xl">🏅</div>}<div><h3 className="font-black text-brand-950"><BadgeName badge={{ name: draft.name || '勋章名称', effectType: draft.effectType }} /></h3><p className="mt-1 text-xs font-bold text-slate-600">{draft.acquisitionDescription || '填写获取方式后将在这里预览'}</p><p className="mt-1 text-[11px] font-black text-amber-700">{BADGE_EFFECT_TYPE_LABELS[draft.effectType]}</p>{draft.tierEnabled ? <p className="mt-1 text-[11px] font-black text-violet-700">{series.find((item) => item.id === draft.seriesId)?.name || '请选择系列'} · {draft.tierLevel || 1}级</p> : null}</div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-950"><p className="text-[11px] font-black text-slate-500">浅色页面预览</p><p className="mt-2 text-lg font-black"><UserDisplayName name="Jeremy" badge={nicknamePreviewBadge} badgeInteraction="static" showBadgeIcon={false} compact /></p></div><div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"><p className="text-[11px] font-black text-slate-300">深色页面预览</p><p className="mt-2 text-lg font-black"><UserDisplayName name="Jeremy" badge={nicknamePreviewBadge} badgeInteraction="static" showBadgeIcon={false} compact /></p></div></div><p className="mt-3 text-[11px] font-bold text-slate-500">昵称闪光颜色仅在局部闪光带经过时显示，基础文字始终继承页面原本颜色。</p></section>
        <button type="submit" disabled={busy || uploading || Boolean(getAutoRuleError(draft))} className="mt-5 min-h-11 rounded-xl bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : '保存勋章'}</button>
      </form> : null}
      <section className="overflow-hidden rounded-[24px] border border-sky-100 bg-white/85 shadow-sm">
        <div className="divide-y divide-sky-100">
          {visibleBadges.map((badge) => <article key={badge.id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sky-50">
              {badge.iconUrl ? <BadgeImage badge={{ name: badge.name, imageUrl: badge.iconUrl, effectType: badge.effectType }} size="wall" /> : <span className="text-2xl">🏅</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-black text-brand-950"><BadgeName badge={badge} /></h2>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${badge.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{badge.isEnabled ? '启用' : '停用'}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-500">{badge.description || '暂无简介'}</p>
              {badge.tierGroupCode ? <p className="mt-1 text-xs font-bold text-amber-700">成长等级：{badge.series?.name || '旧版成长系列'} · {badge.tierLevel}级</p> : null}
              {badge.rule ? <p className="mt-1 text-xs font-bold text-violet-700">自动规则：{badge.rule.ruleType === 'BADGE_SERIES_COMPLETE' ? '系列全收集' : `${BADGE_RULE_TYPE_LABELS[badge.rule.ruleType]} ${badge.rule.operator === 'GTE' ? '≥' : badge.rule.operator === 'LTE' ? '≤' : '='} ${badge.rule.threshold}`}{badge.rule.isEnabled ? '' : ' · 已停用'}{badge.acquisitionDescriptionCustomized ? ' · 自定义文案' : ''}</p> : badge.grantType === 'AUTO' ? <p className="mt-1 text-xs font-bold text-amber-700">旧业务自动：由生日/演唱会等现有事件服务管理</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setDraft(toDraft(badge))} className="admin-badge-list-button">编辑</button>
              <button type="button" onClick={() => void toggleBadge(badge)} className="admin-badge-list-button">{badge.isEnabled ? '停用' : '启用'}</button>
              {badge.grantType === 'AUTO' && badge.rule ? <>
                <button type="button" disabled={busy} onClick={() => void previewBadgeRule(badge)} className="admin-badge-list-button disabled:opacity-50">预览达标</button>
                <button type="button" disabled={busy || !badge.rule.isEnabled || getBackfillUiState(badge).disabled} onClick={() => void backfillBadge(badge)} title={getBackfillUiState(badge).reason} className="admin-badge-list-button disabled:opacity-50">{getBackfillUiState(badge).label}</button>
              </> : null}
              <button type="button" onClick={() => { setGrantBadgeTarget(badge); setGrantUsers([]); setGrantUserId(''); setGrantReason(''); setGrantConfirmed(false); setGrantUserStatus(null) }} className="admin-badge-list-button">{badge.availableFrom || badge.availableUntil ? '手动补发' : '发放'}</button>
              <button type="button" onClick={() => void loadOwners(badge)} className="admin-badge-list-button">获得用户</button>
              <button type="button" onClick={() => void deleteBadge(badge)} className="admin-badge-list-button danger">删除</button>
            </div>
          </article>)}
        </div>
        {!visibleBadges.length ? <p className="p-8 text-center text-sm font-bold text-slate-500">没有符合条件的勋章。</p> : null}
      </section>

      {preview ? <div className="badge-detail-backdrop" role="presentation" onMouseDown={() => setPreview(null)}><section className="badge-admin-dialog max-w-md" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setPreview(null)} className="float-right text-2xl text-slate-500" aria-label="关闭">×</button><h2 className="text-xl font-black text-brand-950">「{preview.name}」达标预览</h2><p className="mt-2 text-xs font-bold leading-5 text-slate-500">只读计算，不会授予勋章。规则修改也不会撤销已经获得的历史荣誉。</p>{previewData ? <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-violet-50 p-3"><strong className="block text-xl font-black text-violet-800">{previewData.eligibleCount}</strong><span className="text-[11px] font-bold text-slate-500">符合条件</span></div><div className="rounded-xl bg-emerald-50 p-3"><strong className="block text-xl font-black text-emerald-800">{previewData.ownedCount}</strong><span className="text-[11px] font-bold text-slate-500">已获得</span></div><div className="rounded-xl bg-amber-50 p-3"><strong className="block text-xl font-black text-amber-800">{previewData.pendingCount}</strong><span className="text-[11px] font-bold text-slate-500">待补发</span></div></div> : <p className="mt-5 text-sm font-bold text-slate-500">正在聚合统计…</p>}{previewData ? <><p className="mt-3 text-center text-xs font-black text-slate-500">当前状态：{previewData.availability === 'PERMANENT' ? '永久可获得' : previewData.availability === 'AVAILABLE' ? '限定开放中' : previewData.availability === 'UPCOMING' ? '尚未开放' : '已绝版'}</p>{previewData.historical?.message ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">{previewData.historical.message}；如需补发，请使用“手动补发”并填写原因。</p> : previewData.historical?.mode === 'HISTORICAL_WINDOW' ? <p className="mt-2 rounded-xl bg-violet-50 p-3 text-xs font-bold leading-5 text-violet-800">本次预览按限定期历史数据计算：{previewData.historical.basis}。</p> : null}</> : null}</section></div> : null}
      {ownersBadge ? <div className="badge-detail-backdrop" role="presentation" onMouseDown={() => setOwnersBadge(null)}><section className="badge-admin-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setOwnersBadge(null)} className="float-right text-2xl text-slate-500" aria-label="关闭">×</button><h2 className="text-xl font-black text-brand-950">{ownersBadge.name} · 获得用户</h2><p className="mt-1 text-xs font-bold text-slate-500">共 {owners.length} 人</p><div className="mt-4 max-h-80 space-y-2 overflow-auto">{owners.map((owner) => <div key={owner.id} className="flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-sm"><span className="font-black text-brand-950">{owner.user.displayName} <small className="text-slate-500">UID {owner.user.uid}</small></span><span className="flex items-center gap-2 text-right text-[11px] font-bold text-slate-500"><span>{formatDate(owner.obtainedAt)}{owner.grantReason ? <><br />{owner.grantReason}</> : null}</span><button type="button" onClick={() => void revokeOwner(owner)} disabled={busy} className="admin-badge-list-button danger">收回</button></span></div>)}</div></section></div> : null}
      {grantBadgeTarget ? <div className="badge-detail-backdrop" role="presentation" onMouseDown={() => setGrantBadgeTarget(null)}><section className="badge-admin-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setGrantBadgeTarget(null)} className="float-right text-2xl text-slate-500" aria-label="关闭">×</button><h2 className="text-xl font-black text-brand-950">{grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil ? '手动补发' : '发放'}「{grantBadgeTarget.name}」</h2>{grantBadgeTarget.availabilityStatus === 'UPCOMING' ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">该勋章限定期尚未开始；本次仅是管理员人工发放，不代表历史资格补发。</p> : null}<div className="mt-4 flex gap-2"><input value={grantQuery} onChange={(event) => setGrantQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchGrantUsers() } }} placeholder="昵称 / UID / 登录账号" className="admin-badge-input" /><button type="button" onClick={() => void searchGrantUsers()} className="admin-badge-list-button">搜索</button></div><div className="mt-2 space-y-1">{grantUsers.map((user) => <button type="button" key={user.id} onClick={() => void selectGrantUser(user)} className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-black ${grantUserId === user.id ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-950'}`}>{user.displayName} · UID {user.uid}</button>)}</div>{grantUserStatus ? <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs font-bold text-slate-600"><p className="font-black text-brand-950">{grantUserStatus.user.displayName} · E院ID {grantUserStatus.user.uid}</p><p className="mt-1">状态：{grantUserStatus.ownership.owned ? `已于 ${grantUserStatus.ownership.obtainedAt ? formatDate(grantUserStatus.ownership.obtainedAt) : '此前'} 获得` : '尚未获得'}</p>{grantUserStatus.rule && grantUserStatus.rule.threshold !== null && (grantUserStatus.historicalMetric !== null || grantUserStatus.currentMetric !== null) ? <p className="mt-1">{grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil ? '限定期历史进度' : '当前规则进度'}：{grantUserStatus.historicalMetric ?? grantUserStatus.currentMetric} / {grantUserStatus.rule.threshold}</p> : null}{grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil ? <p className="mt-1 text-amber-800">{grantUserStatus.rule?.historicalSupported ? `历史依据：${grantUserStatus.rule.historicalBasis}` : '系统无法可靠证明限定期历史达标时间，请以人工核实为准。'}</p> : null}</div> : null}<textarea value={grantReason} onChange={(event) => setGrantReason(event.target.value)} placeholder={grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil ? '限定勋章补发原因（必填）' : '发放原因（可选）'} className="admin-badge-input mt-3 min-h-20" />{grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil ? <label className="mt-3 flex items-start gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={grantConfirmed} onChange={(event) => setGrantConfirmed(event.target.checked)} className="mt-0.5" />我已核实该用户在限定时间内符合获得条件</label> : null}<button type="button" onClick={() => void grantSelected()} disabled={busy || !grantUserId || !grantUserStatus || grantUserStatus.ownership.owned || Boolean((grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil) && (!grantReason.trim() || !grantConfirmed))} className="mt-3 min-h-10 rounded-xl bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? '处理中…' : grantBadgeTarget.availableFrom || grantBadgeTarget.availableUntil ? '确认手动补发' : '确认发放'}</button></section></div> : null}
    </div>
  )
}
