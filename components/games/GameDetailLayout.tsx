import Link from 'next/link'
import type { ReactNode } from 'react'
import type { GameCatalogItem } from '@/lib/game-catalog'

export function GameDetailLayout({ game, actions, children }: Readonly<{
  game: GameCatalogItem
  actions: ReactNode
  children?: ReactNode
}>) {
  const isDailyPrescription = game.slug === 'daily-prescription'

  return (
    <main className={isDailyPrescription ? 'site-page-main flat-page daily-prescription-page mx-auto max-w-7xl px-4 py-5 sm:px-5' : 'game-detail-page games-full-width'}>
      <div className={isDailyPrescription ? 'daily-prescription-page-inner' : 'game-detail-inner'}>
        <Link className={isDailyPrescription ? 'daily-prescription-back' : 'game-detail-back'} href={isDailyPrescription ? '/checkin' : '/games'}>
          {isDailyPrescription ? '← 返回每日挂号' : '← 返回游戏大厅'}
        </Link>
        {isDailyPrescription ? (
          <header className="daily-prescription-page-heading">
            <p className="daily-prescription-kicker">E院每日功能</p>
            <h1>{game.title}</h1>
            <p>{game.longDescription}</p>
          </header>
        ) : (
          <section className="game-detail-banner" data-accent={game.accent} data-slug={game.slug}>
            <div>
              <h1>{game.title}</h1>
              <p>{game.longDescription}</p>
              <div className="game-detail-tags">{game.tags.map((tag) => <b key={tag}>{tag}</b>)}</div>
            </div>
            <aside>{actions}</aside>
          </section>
        )}
        {children}
        {!isDailyPrescription ? (
          <section className="game-detail-sections">
            <article>
              <h2>玩法说明</h2>
              <ol>{game.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
            </article>
            <article>
              <h2>奖励与积分</h2>
              <ul>{game.rewards.map((reward) => <li key={reward}>{reward}</li>)}</ul>
            </article>
          </section>
        ) : null}
      </div>
    </main>
  )
}
