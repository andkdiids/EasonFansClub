'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './send-anonymous-letter.module.css'

/**
 * V4.2 — one shared 1500ms timeline.
 *
 * Every visual beat is a CSS keyframe on that same clock, so folding →
 * inserting → sealing → stamping → flying overlap by design: no per-stage
 * transition, no accumulated timers and no static pauses between beats. React
 * only swaps the hint text when a beat begins, then fires the completion once.
 *
 * The overlay is portalled to <body> and the skip button is a fixed sibling of
 * the 3D envelope container, so it is on the top layer of the app, clickable
 * from the very first frame, and never rotates/scales/flies with the envelope.
 *
 * Purely decorative: mounted only after the server confirmed the letter and its
 * notification are stored. It never calls the API, skipping changes nothing, and
 * `prefers-reduced-motion` collapses the timeline to a short, static success state.
 */

/** Hard budget: the whole animation must finish within 1500ms. */
export const ANIMATION_MS = 1500

/**
 * When the success state takes over. The overlay is inserted a frame before the
 * browser starts its CSS clock, so handing off exactly on ANIMATION_MS would
 * keep the dialog mounted for ~16ms past the budget. Two frames of headroom
 * keep the *whole* mount→unmount window inside 1500ms; at that point the
 * envelope is already off-screen, so nothing visible is cut short.
 */
export const HANDOFF_MS = ANIMATION_MS - 32

/** Absolute offsets on the shared ANIMATION_MS clock (milliseconds from mount). */
export const TIMELINE = {
  paper: { start: 0, end: 120 },
  folding: { start: 100, end: 380 },
  inserting: { start: 300, end: 700 },
  sealing: { start: 620, end: 900 },
  stamping: { start: 850, end: 1120 },
  flying: { start: 1080, end: ANIMATION_MS },
} as const

export type Stage = keyof typeof TIMELINE
const STAGES = Object.keys(TIMELINE) as Stage[]

const HINTS: Record<Stage, string> = {
  paper: '信写好了',
  folding: '正在折好这封信…',
  inserting: '装进信封…',
  sealing: '封口…',
  stamping: '盖火漆…',
  flying: '寄出…',
}

export function SendAnonymousLetter({ message, onComplete, variant = 'take' }: {
  message: string
  onComplete: () => void
  /**
   * Which letter this is. Both variants share one component, one CSS timeline
   * and one set of timings; only the accessible label differs, so a screen
   * reader never announces a capture note as an anonymous letter.
   */
  variant?: 'take' | 'capture'
}) {
  const [stage, setStage] = useState<Stage>('paper')
  const finished = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timers: number[] = []
    const finish = () => {
      if (finished.current) return
      finished.current = true
      onCompleteRef.current()
    }
    if (reduce) {
      // Static sealed envelope: no motion, just a beat before the success state.
      timers.push(window.setTimeout(finish, 120))
    } else {
      // Absolute offsets from mount — the beats overlap; nothing is accumulated.
      // The CSS keyframes carry all motion, so these only swap the hint label.
      for (const next of STAGES) {
        if (next === 'paper') continue
        timers.push(window.setTimeout(() => setStage(next), TIMELINE[next].start))
      }
      // Single completion at the end of the shared clock. `finished` makes both
      // this and every skip click idempotent.
      timers.push(window.setTimeout(finish, HANDOFF_MS))
    }
    return () => { for (const timer of timers) window.clearTimeout(timer) }
  }, [])

  const skip = () => {
    if (finished.current) return
    finished.current = true
    onCompleteRef.current()
  }

  const tree = (
    <div className={styles.overlay} role="dialog" aria-modal="true"
      aria-label={variant === 'capture' ? '正在寄出留言' : '正在寄出匿名信'}>
      <div className={styles.scrim} />
      <div className={styles.desk} data-stage={stage}>
        <div className={styles.envelope}>
          <div className={styles.envBack} aria-hidden="true" />
          {/* The written half stays put; the blank lower half lifts over it. */}
          <div className={styles.sheet} aria-hidden="true">
            <div className={styles.sheetUpper}><p className={styles.ink}>{message}</p></div>
            <div className={styles.sheetLower} />
          </div>
          <div className={styles.pocket} aria-hidden="true" />
          <div className={styles.flap} aria-hidden="true" />
          <div className={styles.wax} aria-hidden="true"><span>E</span></div>
          <div className={styles.stamp} aria-hidden="true"><span>E</span></div>
        </div>
      </div>
      <p className={styles.hint} role="status">{HINTS[stage]}</p>
      {/* Fixed, portalled, first-frame clickable — deliberately NOT inside .desk. */}
      <button type="button" className={styles.skip} onClick={skip}>跳过动画</button>
    </div>
  )

  // Portal above every page stacking context (bottom nav, friend dock, dialogs).
  // This component only mounts after a client-side send, so document always exists.
  return typeof document === 'undefined' ? null : createPortal(tree, document.body)
}
