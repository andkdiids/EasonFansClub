'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { GameCatalogItem } from '@/lib/game-catalog'

export function GameBanner({ games }: Readonly<{ games: GameCatalogItem[] }>) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = games[activeIndex] || games[0]

  useEffect(() => {
    if (games.length < 2) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setActiveIndex((index) => (index + 1) % games.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [games.length])

  if (!active) return null
  return (
    <section className="game-banner" data-accent={active.accent} aria-roledescription="carousel">
      <div className="game-banner-copy">
        <h2>{active.title}</h2>
        <p>{active.description}</p>
        {active.available ? <Link href={`/games/${active.slug}`}>查看游戏</Link> : <b>即将开放</b>}
      </div>
      <div className="game-banner-art" aria-hidden="true">
        <i />
      </div>
      <nav aria-label="推荐游戏切换">
        {games.map((game, index) => (
          <button
            key={game.slug}
            type="button"
            aria-label={`查看推荐：${game.title}`}
            aria-current={index === activeIndex}
            onClick={() => setActiveIndex(index)}
          />
        ))}
      </nav>
    </section>
  )
}
