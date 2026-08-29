'use client'

import Link from 'next/link'
import { UiIcon } from '@/components/UiIcon'

/** Legacy entertainment entry surface for interactive games only. */
export function EntertainmentCenter() {
  return (
    <>
      <header className="entertainment-heading">
        <h1>娱乐天空</h1>
        <span>发现更多有趣的互动游戏</span>
      </header>

      <section className="entertainment-entry-grid" aria-label="娱乐天空功能">
        <Link href="/games/guess-song" className="entertainment-entry is-active">
          <UiIcon name="music" />
          <span><strong>听听</strong><small>听短音频，猜出正确歌曲</small></span>
          <b>立即挑战</b>
        </Link>
        <div className="entertainment-entry is-coming">
          <UiIcon name="archive" />
          <span><strong>E院成就</strong><small>收藏属于你的 E院时刻</small></span>
          <b>即将开放</b>
        </div>
      </section>
    </>
  )
}
