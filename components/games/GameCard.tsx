'use client'

import Link from 'next/link'
import type { GameCatalogItem } from '@/lib/game-catalog'

export function GameCard({ game, bestScore }: Readonly<{ game: GameCatalogItem; bestScore?: number | null }>) {
  const body = (
    <>
      <div className="game-card-cover" data-accent={game.accent}>
        <i aria-hidden="true" />
      </div>
      <div className="game-card-body">
        <div className="game-card-title-row">
          <h3>{game.title}</h3>
          <span>{game.difficulty}</span>
        </div>
        <p>{game.description}</p>
        <dl>
          <div><dt>参与</dt><dd>{game.players}</dd></div>
          <div><dt>游玩</dt><dd>{game.plays}</dd></div>
          <div><dt>最佳</dt><dd>{bestScore == null ? '—' : `${bestScore} 分`}</dd></div>
        </dl>
        <footer>
          <div>{game.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <b>{game.available ? '进入游戏' : '敬请期待'}</b>
        </footer>
      </div>
    </>
  )

  return game.available ? (
    <Link href={`/games/${game.slug}`} className="game-card">
      {body}
    </Link>
  ) : (
    <article className="game-card is-disabled">
      {body}
    </article>
  )
}
