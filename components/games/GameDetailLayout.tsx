import Link from 'next/link'
import type { ReactNode } from 'react'
import type { GameCatalogItem } from '@/lib/game-catalog'

export function GameDetailLayout({ game, actions, children }: Readonly<{
  game: GameCatalogItem
  actions: ReactNode
  children?: ReactNode
}>) {
  return (
    <main className="game-detail-page games-full-width">
      <div className="game-detail-inner">
        <Link className="game-detail-back" href="/games">← 返回游戏大厅</Link>
        <section className="game-detail-banner" data-accent={game.accent} data-slug={game.slug}>
          <div>
            <h1>{game.title}</h1>
            <p>{game.longDescription}</p>
            <div className="game-detail-tags">{game.tags.map((tag) => <b key={tag}>{tag}</b>)}</div>
          </div>
          <aside>{actions}</aside>
        </section>
        {children}
        {game.slug !== 'daily-prescription' ? (
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
