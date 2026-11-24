'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import styles from './anonymous-letter.module.css'

export type AnonymousLetterPerson = { uid: number; nickname: string; avatarUrl: string | null }

export type AnonymousLetterResult = {
  outcome: 'SUCCESS' | 'FAILED'
  recovered: number
  amount: number
  person: AnonymousLetterPerson | null
}

export type AnonymousLetterData = {
  id: string
  roundId: string
  content: string
  createdAt: string
  captured: boolean
  capturable: boolean
  /** Present only once the round is settled; `null` keeps the letter anonymous. */
  result?: AnonymousLetterResult | null
  goldenUntil: string
  amount: number
}

type Stage = 'flying' | 'hovering' | 'opening' | 'open'

/** Milliseconds, matching the CSS keyframes. Whole sequence stays under 2.5s. */
const TIMING = { flying: 620, hovering: 420, opening: 560 } as const

const ANONYMOUS_TITLE = '一封来自神秘 EF 的信'
const ANONYMOUS_SIGNATURE = '—— 一位神秘的 EF'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The mystery letter overlay. Purely presentational: it receives one already
 * authorised letter and reports intent back to the caller. Animation is CSS
 * transform/opacity only, is skippable, honours `prefers-reduced-motion` and
 * never blocks the actions underneath once open.
 *
 * `instant` skips the fly-in entirely so re-opening the letter from a record
 * shows the paper straight away instead of replaying the entrance.
 *
 * Three states share one paper:
 * - still open for investigation → anonymous heading, original note, 「立即调查」;
 * - investigated and recovered   → real sender, 「抓到你啦！」 and the amount;
 * - investigated and missed      → real sender, 「让 TA 溜了！」 and the amount.
 * The settled state renders the verdict inline, so it never depends on another
 * button that could silently do nothing.
 */
export function AnonymousLetter({ letter, busy, error, instant = false, onInvestigate, onClose, onShowRecord, onRetry }: {
  letter: AnonymousLetterData
  busy: boolean
  error?: string
  instant?: boolean
  onInvestigate: () => void
  onClose: () => void
  onShowRecord?: () => void
  onRetry?: () => void
}) {
  const [stage, setStage] = useState<Stage>(() => (instant || prefersReducedMotion() ? 'open' : 'flying'))
  const closeRef = useRef<HTMLButtonElement>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (instant) return
    const sequence: Array<[Stage, number]> = [['hovering', TIMING.flying], ['opening', TIMING.flying + TIMING.hovering],
      ['open', TIMING.flying + TIMING.hovering + TIMING.opening]]
    for (const [next, delay] of sequence) {
      timers.current.push(window.setTimeout(() => setStage(next), delay))
    }
    return () => { timers.current.forEach(window.clearTimeout); timers.current = [] }
  }, [instant])

  useEffect(() => {
    if (stage === 'open') closeRef.current?.focus()
  }, [stage])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const skip = () => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    setStage('open')
  }

  const result = letter.result ?? null
  // A settled round reveals the real sender; a hidden account cannot, so that
  // case keeps the anonymous heading instead of showing a blank nickname.
  const sender = result?.person ?? null
  const title = sender ? `来自「${sender.nickname}」的信` : ANONYMOUS_TITLE
  const signature = sender ? `—— ${sender.nickname}` : ANONYMOUS_SIGNATURE
  const avatar = publicImageUrl(sender?.avatarUrl)
  const primary = result ? null : letter.capturable
    ? { label: busy ? '前往调查中…' : '立即调查', run: onInvestigate }
    : error && onRetry ? { label: '重试', run: onRetry } : null
  const actionCount = (primary ? 1 : 0) + (result && onShowRecord ? 1 : 0) + 1

  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="anon-letter-title"
    data-letter-state={result ? result.outcome : 'unresolved'}>
    <div className={styles.scrim} aria-hidden="true" />
    <div className={styles.stage} data-stage={stage}>
      <div className={styles.envelope} aria-hidden={stage !== 'open'}>
        <div className={styles.flap} />
        <div className={styles.seal} />
        <div className={styles.envelopeHint}>神秘来信</div>
      </div>
      <article className={styles.paper} aria-hidden={stage !== 'open'}>
        <header className={styles.paperHead}>
          <span className={styles.rule} aria-hidden="true" />
          <h2 id="anon-letter-title" key={title}>{title}</h2>
        </header>
        {/* Rendered as a text node on purpose: user content is never interpreted as markup. */}
        <p className={styles.body}>{letter.content}</p>
        <p className={styles.signature}>{signature}</p>
        {result && <section className={styles.verdict} data-outcome={result.outcome} aria-live="polite">
          <p className={styles.verdictTitle}>
            <span className={styles.stamp} aria-hidden="true">{result.outcome === 'SUCCESS' ? '抓着' : '溜了'}</span>
            <strong>{result.outcome === 'SUCCESS' ? '抓到你啦！' : '让 TA 溜了！'}</strong>
          </p>
          <p className={styles.verdictAmount}>
            {result.outcome === 'SUCCESS' ? `成功追回 ${result.recovered} 挂号费` : `本次未追回 ${result.amount} 挂号费`}
          </p>
          {sender
            ? <Link className={styles.verdictPerson} href={`/user/${formatUid(sender.uid)}`}>
              {avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" width={34} height={34} />
              )}
              <span>{sender.nickname}</span>
            </Link>
            : <p className={styles.verdictPerson}>对方账号已不可展示</p>}
        </section>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions} data-single={actionCount < 2 ? 'true' : undefined}>
          {primary && <button type="button" className={styles.primary} disabled={busy || stage !== 'open'}
            onClick={primary.run}>{primary.label}</button>}
          {result && onShowRecord && <button type="button" disabled={stage !== 'open'}
            onClick={onShowRecord}>查看顺取记录</button>}
          <button type="button" ref={closeRef} disabled={stage !== 'open'} onClick={onClose}>收下这封信</button>
        </div>
        {!result && !letter.capturable && <p className={styles.hint}>本次记录已不可抓捕，你仍可以在顺大师记录里查看详情。</p>}
      </article>
      {stage !== 'open' && <button type="button" className={styles.skip} onClick={skip}>跳过动画</button>}
    </div>
  </div>
}
