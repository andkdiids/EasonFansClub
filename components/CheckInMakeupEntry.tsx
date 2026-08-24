'use client'

import { useEffect, useState } from 'react'
import { CheckInMakeupDialog } from '@/components/CheckInMakeupDialog'
import { redirectToLoginAfterConfirmedSessionInvalid } from '@/lib/client-auth'

type AvailableDate = {
  dateKey: string
  cost: number
  freeChallengeAvailable: boolean
  canUseNow?: boolean
  weeklyUsed?: boolean
  blockedReason?: 'WEEKLY_LIMIT_USED' | 'OUTSIDE_MAKEUP_WINDOW'
}

type AvailabilityResponse = {
  makeup: {
    availableDates: AvailableDate[]
    eligibleDateKeys?: string[]
    weeklyLimit: number
    weeklyUsed: boolean
    weeklyAvailable: boolean
    weeklyRemaining: number
    monthlyChallengeAvailable: boolean
    monthlyChallengePending: boolean
    monthlyChallengeTargetDate: string | null
    cost: number
    currentBalance: number
  }
}

function isAvailabilityResponse(value: unknown): value is AvailabilityResponse {
  if (!value || typeof value !== 'object') return false
  const makeup = (value as { makeup?: unknown }).makeup
  if (!makeup || typeof makeup !== 'object') return false
  const item = makeup as Partial<AvailabilityResponse['makeup']>
  return Array.isArray(item.availableDates)
    && typeof item.monthlyChallengeAvailable === 'boolean'
    && typeof item.monthlyChallengePending === 'boolean'
    && (item.monthlyChallengeTargetDate === null || typeof item.monthlyChallengeTargetDate === 'string')
    && Number.isSafeInteger(item.weeklyLimit)
    && Number.isSafeInteger(item.weeklyRemaining)
    && typeof item.weeklyUsed === 'boolean'
    && Number.isSafeInteger(item.cost)
    && Number.isSafeInteger(item.currentBalance)
}

function formatDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-')
  return `${year}年${month}月${day}日`
}

export function CheckInMakeupEntry({ previewMode = false }: Readonly<{ previewMode?: boolean }>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null)
  const [selected, setSelected] = useState<AvailableDate | null>(null)

  async function loadAvailability() {
    if (previewMode) return
    setIsLoading(true)
    setLoadError('')
    try {
      const response = await fetch('/api/checkin/history', { cache: 'no-store', headers: { Accept: 'application/json' } })
      const data = await response.json().catch(() => null) as AvailabilityResponse | { message?: string } | null
      if (response.status === 401) {
        if (!(await redirectToLoginAfterConfirmedSessionInvalid(response, '/checkin'))) setLoadError('登录状态暂时无法确认，请稍后重试。')
        return
      }
      if (!response.ok || !isAvailabilityResponse(data)) throw new Error(data && 'message' in data ? data.message : '可补签日期暂时无法加载')
      setAvailability(data)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '可补签日期暂时无法加载')
    } finally {
      setIsLoading(false)
    }
  }

  function openEntry() {
    if (previewMode) return
    setIsOpen(true)
    void loadAvailability()
  }

  function closeEntry() {
    setIsOpen(false)
    setSelected(null)
  }

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selected) setSelected(null)
      else closeEntry()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, selected])

  return (
    <>
      <button type="button" className="checkin-history-trigger checkin-makeup-entry-trigger" disabled={previewMode} onClick={openEntry} aria-haspopup="dialog">
        <span aria-hidden="true">↺</span>
        补签
      </button>

      {isOpen ? (
        <div className="checkin-history-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeEntry() }}>
          <section className="checkin-history-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-makeup-entry-title">
            <header className="checkin-history-dialog-header">
              <div className="checkin-history-dialog-heading">
                <p>CHECK-IN MAKEUP</p>
                <h2 id="checkin-makeup-entry-title" className="checkin-history-month-title">补签</h2>
              </div>
              <button type="button" className="checkin-history-close" onClick={closeEntry} aria-label="关闭补签">×</button>
            </header>
            <div className="checkin-history-dialog-body">
              <p className="checkin-makeup-entry-intro">系统已根据你的注册日期和签到历史列出全部历史缺签日期，无需手动查找日期。</p>
              {loadError ? <p className="checkin-history-state is-error" role="alert">{loadError}</p> : null}
              {isLoading ? <p className="checkin-history-state" aria-live="polite">正在读取可补签日期…</p> : null}
              {!isLoading && !loadError && availability?.makeup.availableDates.length === 0 ? (
                <p className="checkin-history-empty" role="status">目前没有可补签的日期</p>
              ) : null}
              {!isLoading && !loadError && availability?.makeup.availableDates.length ? (
                <>
                  <p className="checkin-makeup-entry-count" role="status">共 {availability.makeup.availableDates.length} 个历史缺签日期</p>
                  <div className="checkin-makeup-entry-list">
                  {availability.makeup.availableDates.map((item) => (
                    <article key={item.dateKey} className="checkin-makeup-entry-item">
                      <div className="checkin-makeup-entry-item-copy">
                        <h3>{formatDate(item.dateKey)}</h3>
                        <p>未签到</p>
                        <p className="checkin-makeup-entry-cost">{item.freeChallengeAvailable ? '本月免费补签挑战可用' : `补签费用：${item.cost} 挂号费`}</p>
                        {item.canUseNow === false ? <p className="text-amber-700">本周补签次数已用完</p> : null}
                      </div>
                      <button type="button" className="checkin-makeup-entry-action" disabled={item.canUseNow === false} onClick={() => setSelected(item)}>{item.canUseNow === false ? '本周已用完' : '补签'}</button>
                    </article>
                  ))}
                  </div>
                </>
              ) : null}
              {availability ? <p className="checkin-makeup-entry-hint">{availability.makeup.weeklyRemaining === 0 && availability.makeup.availableDates.length > 0 ? `本周补签次数已用完；你仍有 ${availability.makeup.availableDates.length} 个历史缺签日期，下周可继续补签。` : '每周最多补签 1 次；补签会计入连续挂号，但不会补发当天普通签到奖励。'}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {selected ? (
        <CheckInMakeupDialog
          key={selected.dateKey}
          targetDate={selected.dateKey}
          monthlyChallengeAvailable={Boolean(availability?.makeup.monthlyChallengeAvailable)}
          monthlyChallengePending={Boolean(availability?.makeup.monthlyChallengePending && availability.makeup.monthlyChallengeTargetDate === selected.dateKey)}
          currentBalance={availability?.makeup.currentBalance ?? 0}
          cost={selected.cost}
          onClose={() => setSelected(null)}
          onCompleted={() => { void loadAvailability() }}
        />
      ) : null}
    </>
  )
}
