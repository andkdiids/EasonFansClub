'use client'

import Link from 'next/link'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import styles from './capture-letter.module.css'

export type CaptureLetterData = {
  id: string
  roundId: string
  content: string
  createdAt: string
  person: { uid: number; nickname: string; avatarUrl: string | null } | null
  recovered: number
  bonus: number
}

/**
 * Reading view for a capture counter note.
 *
 * The note is signed on purpose: the caught actor already knows a capture
 * happened, so they are told who caught them. Only the public projection is
 * rendered — nickname, avatar and uid — never an account id, email or phone.
 *
 * No delivery animation is replayed here; the note arrives after the capture
 * result, and the paper look is the same one the anonymous letter uses.
 */
export function CaptureLetter({ letter, busy, error, onInvestigate, onClose }: {
  letter: CaptureLetterData
  busy: boolean
  error: string
  onInvestigate: () => void
  onClose: () => void
}) {
  const avatar = publicImageUrl(letter.person?.avatarUrl)
  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="capture-letter-title">
    <article className={styles.paper}>
      <p className={styles.eyebrow}>抓获你的这位 EF 留言了</p>
      <h2 id="capture-letter-title">{letter.person?.nickname || '一位 EF'}</h2>
      <div className={styles.person}>
        {avatar
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={avatar} alt="" width={40} height={40} />
          : <span className={styles.avatarFallback} aria-hidden="true">E</span>}
        {letter.person
          ? <Link href={`/user/${formatUid(letter.person.uid)}`}>{letter.person.nickname}</Link>
          : <span>这位 EF 暂时无法展示</span>}
        {letter.person && <span className={styles.uid}>UID {formatUid(letter.person.uid)}</span>}
      </div>
      <p className={styles.body}>{letter.content}</p>
      <p className={styles.verdict}>
        你顺走的 <strong>{letter.recovered}</strong> 挂号费已被成功追回
        {letter.bonus > 0 ? `，对方还额外获得了 ${letter.bonus} 挂号费奖励` : ''}。
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={onInvestigate}>
          {busy ? '打开中…' : '查看调查结果'}
        </button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </article>
  </div>
}
