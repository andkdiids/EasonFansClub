'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './send-anonymous-letter.module.css'

/**
 * Sending a letter: paper → fold → into the envelope → flap closes → wax stamp
 * presses → the sealed envelope flies away.
 *
 * The fold is a real 3D rotation around the crease (the blank lower half lifts
 * and covers the written half), the paper then slides behind the envelope's
 * front pocket so it is genuinely occluded instead of fading out, and the wax
 * seal is produced by a stamp that comes down, presses, and lifts off.
 *
 * Purely decorative: mounted only after the server confirmed the letter and its
 * notification are stored. It never calls the API, skipping changes nothing, and
 * `prefers-reduced-motion` collapses the timeline to a short pause.
 */

const STAGES = ['paper', 'folding', 'inserting', 'sealing', 'stamping', 'flying'] as const
type Stage = typeof STAGES[number]

/** ~4.6s in total: slower beats read better on a phone than a quick flourish. */
const STAGE_MS: Record<Stage, number> = {
  paper: 700, folding: 650, inserting: 650, sealing: 500, stamping: 700, flying: 700,
}

const HINTS: Record<Stage, string> = {
  paper: '信写好了',
  folding: '正在折好这封信…',
  inserting: '装进信封…',
  sealing: '封口…',
  stamping: '盖火漆…',
  flying: '寄出…',
}

export function SendAnonymousLetter({ message, onComplete }: { message: string; onComplete: () => void }) {
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
      timers.push(window.setTimeout(finish, 240))
    } else {
      let elapsed = 0
      for (const next of STAGES) {
        elapsed += STAGE_MS[next]
        if (next === 'paper') continue
        timers.push(window.setTimeout(() => setStage(next), elapsed))
      }
      // Keep the dialog mounted until the fly-out animation has actually
      // finished. Unmounting right after the stage switch cut the envelope off
      // mid-flight, so the user never saw it leave the screen.
      timers.push(window.setTimeout(finish, elapsed + STAGE_MS.flying))
    }
    return () => { for (const timer of timers) window.clearTimeout(timer) }
  }, [])

  const skip = () => {
    if (finished.current) return
    finished.current = true
    onCompleteRef.current()
  }

  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="正在寄出匿名信">
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
    <button type="button" className={styles.skip} onClick={skip}>跳过动画</button>
  </div>
}
