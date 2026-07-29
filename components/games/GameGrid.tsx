import type { GameCatalogItem } from '@/lib/game-catalog'
import { GameCard } from './GameCard'

export function GameGrid({ games, bestScores = {} }: Readonly<{
  games: GameCatalogItem[]
  bestScores?: Record<string, number | null>
}>) {
  if (!games.length) {
    return <div className="game-grid-empty">没有找到符合条件的游戏，试试其他关键词。</div>
  }
  return (
    <div className="game-grid">
      {games.map((game) => <GameCard key={game.slug} game={game} bestScore={bestScores[game.slug]} />)}
    </div>
  )
}
