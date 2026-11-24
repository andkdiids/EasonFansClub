'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './anonymous-letter.module.css'

export type AnonymousLetterData = {
  id: string
  roundId: string
  content: string
  createdAt: string
  captured: boolean
  capturable: boolean
  goldenUntil: string
  amount: number
}

type Stage = 'flying' | 'hovering' | 'opening' | 'open'

/** Milliseconds, matching the CSS keyframes. Whole sequence stays under 2.5s. */
const TIMING = { flying: 620, hovering: 420, opening: 560 } as const

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
 */
export function AnonymousLetter({ letter, busy, error, instant = false, onInvestigate, onClose, onRetry }: {
  letter: AnonymousLetterData
  busy: boolean
  error?: string
  instant?: boolean
  onInvestigate: () => void
  onClose: () => void
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

  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="anon-letter-title">
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
          <h2 id="anon-letter-title">一封来自神秘 EF 的信</h2>
        </header>
        {/* Rendered as a text node on purpose: user content is never interpreted as markup. */}
        <p className={styles.body}>{letter.content}</p>
        <p className={styles.signature}>—— 一位神秘的 EF</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          {error && !letter.captured && !letter.capturable && onRetry
            ? <button type="button" className={styles.primary} disabled={stage !== 'open'} onClick={onRetry}>重试</button>
            : letter.capturable || letter.captured
              ? <button type="button" className={styles.primary} disabled={busy || stage !== 'open'} onClick={onInvestigate}>
                {busy ? '前往调查中…' : letter.captured ? '查看调查结果' : '立即调查'}
              </button>
              : null}
          <button type="button" ref={closeRef} disabled={stage !== 'open'} onClick={onClose}>收下这封信</button>
        </div>
        {!letter.capturable && !letter.captured && <p className={styles.hint}>本次记录已不可抓捕，你仍可以在顺大师记录里查看详情。</p>}
      </article>
      {stage !== 'open' && <button type="button" className={styles.skip} onClick={skip}>跳过动画</button>}
    </div>
  </div>
}
