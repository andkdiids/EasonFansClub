'use client'

import { useState } from 'react'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'
import { SaveBirthdayCardButton } from '@/components/birthday/SaveBirthdayCardButton'
import type { BirthdayCardImageData } from '@/lib/birthday-card-image'

export function BirthdayCard({
  nickname,
  uid,
  avatarUrl,
  blessing,
  dateText,
}: {
  nickname: string
  uid: number
  avatarUrl: string | null
  blessing: string
  dateText: string | null
}) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const resolvedAvatar = avatarUrl && !avatarFailed ? publicImageVariantUrl(avatarUrl, 'avatar-md') : null

  const cardData: BirthdayCardImageData = { nickname, uid, avatarUrl, blessing, dateText }

  return (
    <div className="birthday-card-shell">
      <div className="birthday-card-frame">
        <div className="birthday-card-content">
          <div className="birthday-card-emoji">🎂</div>
          <div className="birthday-card-title">生日快乐</div>
          <div className="birthday-card-avatar">
            <span className="birthday-card-avatar-fallback">{formatUid(uid).slice(0, 1)}</span>
            {resolvedAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedAvatar}
                alt={nickname}
                className="birthday-card-avatar-img"
                onError={() => setAvatarFailed(true)}
              />
            ) : null}
          </div>
          <div className="birthday-card-name">{nickname}</div>
          <div className="birthday-card-uid">E院ID {formatUid(uid)}</div>
          {dateText ? <div className="birthday-card-date">生日 · {dateText}</div> : null}
          <div className="birthday-card-divider" aria-hidden="true" />
          <p className="birthday-card-blessing">{blessing}</p>
          <div className="birthday-card-brand">来自 <span>私家E院</span></div>
        </div>
      </div>
      <SaveBirthdayCardButton data={cardData} />
    </div>
  )
}
