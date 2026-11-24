'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './send-anonymous-letter.module.css'

/**
 * The sending counterpart of the reading animation: paper → fold → into the
 * envelope → flap closes → wax seal → the envelope flies away.
 *
 * Purely decorative. It is mounted only after the server has confirmed that the
 * letter and its notification were stored, it never calls the API itself, and
 * skipping it changes nothing about the delivery. Under
 * `prefers-reduced-motion` the whole timeline collapses to a short pause.
 */

const STAGES = ['paper', 'folding', 'inserting', 'sealing', 'wax', 'flying'] as const
type Stage = typeof STAGES[number]

const STAGE_MS: Record<Stage, number> = {
  paper: 450, folding: 400, inserting: 400, sealing: 350, wax: 350, flying: 620,
}

export function SendAnonymousLetter({ message, onComplete }: { message: string; onComplete: () => void }) {
  const [stage, setStage] = useState<Stage>('paper')
  const finished = useRef(false)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const timers: number[] = []
    let elapsed = 0
    if (reduce) {
      timers.push(window.setTimeout(() => finish(), 220))
    } else {
      for (const next of STAGES) {
        elapsed += STAGE_MS[next]
        if (next === 'paper') continue
        timers.push(window.setTimeout(() => setStage(next), elapsed))
      }
      timers.push(window.setTimeout(() => finish(), elapsed + 120))
    }
    return () => { for (const timer of timers) window.clearTimeout(timer) }
    // The timeline is intentionally started once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function finish() {
    if (finished.current) return
    finished.current = true
    onComplete()
  }

  const hint = stage === 'paper' || stage === 'folding'
    ? '正在折好这封信…'
    : stage === 'inserting' || stage === 'sealing'
      ? '装进信封…'
      : stage === 'wax' ? '盖上火漆…' : '正在寄出…'

  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="正在寄出匿名信">
    <div className={styles.scrim} />
    <div className={styles.stage} data-stage={stage}>
      <div className={styles.envelope} aria-hidden="true">
        <div className={styles.pocket} />
        <div className={styles.flap} />
        <div className={styles.seal} data-visible={stage === 'wax' || stage === 'flying'}>
          <span>E</span>
        </div>
      </div>
      <div className={styles.sheet} aria-hidden="true">
        <p>{message}</p>
      </div>
      <p className={styles.hint} role="status">{hint}</p>
      <button type="button" className={styles.skip} onClick={finish}>跳过动画</button>
    </div>
  </div>
}
