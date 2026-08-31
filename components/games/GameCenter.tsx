'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { entertainmentGameCatalog, gameCategories, type GameCategoryFilter } from '@/lib/game-catalog'
import { GameBanner } from './GameBanner'
import { GameGrid } from './GameGrid'
import { EntertainmentLeaderboardCenter } from './EntertainmentLeaderboardCenter'

type LobbySummary = {
  weeklyBest: number | null
  monthlyBest: number | null
}

export function GameCenter() {
  const [category, setCategory] = useState<GameCategoryFilter>('全部')
  const [query, setQuery] = useState('')
  const [bestScore, setBestScore] = useState<number | null>()

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/entertainment/guess-song/sessions', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: LobbySummary }
        if (response.ok && payload.ok) {
          setBestScore(Math.max(payload.data?.weeklyBest || 0, payload.data?.monthlyBest || 0) || null)
        }
      })
      .catch(() => setBestScore(null))
    return () => controller.abort()
  }, [])

  const filteredGames = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    return entertainmentGameCatalog.filter((game) => {
      const categoryMatches =
        category === '全部'
        || (category === '热门' && game.tags.includes('热门'))
        || (category === '最新' && game.isNew)
        || game.categories.includes(category as never)
      const queryMatches = !keyword || `${game.title} ${game.description} ${game.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(keyword)
      return categoryMatches && queryMatches
    })
  }, [category, query])

return (
  <main className="games-page games-center-background games-full-width">
    <div className="games-page-inner">
      <header className="games-heading">
        <h1>娱乐天空</h1>
        <p>发现更多有趣的互动游戏</p>
      </header>
      <GameBanner games={entertainmentGameCatalog.filter((game) => game.featured)} />
      <section className="game-duel-entry" aria-labelledby="game-duel-entry-title">
        <div>
          <h2 id="game-duel-entry-title">1v1 对决</h2>
          <p>与好友实时抢答 30 题</p>
        </div>
        <Link href="/games/guess-song/duel">进入对决</Link>
      </section>
      <section className="game-library" aria-labelledby="game-library-title">
        <div className="game-library-heading">
          <div>
            <h2 id="game-library-title">所有游戏</h2>
          </div>
          <label>
            <span className="sr-only">搜索游戏名称</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索游戏名称" />
          </label>
        </div>
        <div className="game-filter-tabs" role="tablist" aria-label="游戏分类">
          {gameCategories.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {bestScore === undefined ? (
          <div className="game-grid game-grid-skeleton" aria-label="游戏列表加载中">
            {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
          </div>
        ) : (
          <GameGrid games={filteredGames} bestScores={{ 'guess-song': bestScore }} />
        )}
      </section>
      <EntertainmentLeaderboardCenter />
    </div>
  </main>
)
}
