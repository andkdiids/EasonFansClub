import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { isAppNavigationActive, primaryNavigation } from '../components/layout/navigation'
import { ECENTER_FEATURES } from '../lib/ecenter-features'
import { entertainmentGameCatalog, findGame, gameCatalog } from '../lib/game-catalog'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日处方只保留今日处方领取入口并脱离游戏详情 Hero', () => {
  const page = read('app/games/[slug]/page.tsx')
  const gamesLayout = read('app/games/layout.tsx')
  const layout = read('components/games/GameDetailLayout.tsx')
  const detail = read('components/games/DailyPrescriptionDetail.tsx')

  assert.doesNotMatch(page, /立即领取/)
  assert.match(page, /game\.slug === 'daily-prescription'/)
  assert.match(layout, /site-page-main flat-page daily-prescription-page/)
  assert.match(layout, /href=\{isDailyPrescription \? '\/checkin' : '\/games'\}/)
  assert.match(layout, /返回每日挂号/)
  assert.match(gamesLayout, /daily-prescription-route-root/)
  assert.match(gamesLayout, /games-route-root games-center-background games-full-width/)
  assert.doesNotMatch(layout, /game-detail-banner.*daily-prescription/)
  assert.match(detail, /className="daily-prescription-panel"/)
  assert.equal(detail.match(/领取今日处方/g)?.length, 1)
  assert.match(detail, /fetch\('\/api\/entertainment\/daily-draw'/)
  assert.match(detail, /method: 'POST'/)
})

test('每日处方保留直达路由，但不会出现在娱乐天空推荐或游戏列表', () => {
  const center = read('components/games/GameCenter.tsx')
  const catalog = read('lib/game-catalog.ts')
  const legacyCenter = read('app/entertainment/EntertainmentCenter.tsx')

  assert.equal(findGame('daily-prescription')?.title, '每日处方')
  assert.equal(gameCatalog.some((game) => game.slug === 'daily-prescription'), true)
  assert.equal(entertainmentGameCatalog.some((game) => game.slug === 'daily-prescription'), false)
  assert.match(catalog, /showInEntertainment: false/)
  assert.match(center, /entertainmentGameCatalog/)
  assert.doesNotMatch(legacyCenter, /daily-draw|每日抽奖|每日处方/)
})

test('E院中心保留每日处方且每日处方页不会把娱乐天空标记为当前栏目', () => {
  const prescription = ECENTER_FEATURES.find((feature) => feature.featureKey === 'DAILY_PRESCRIPTION')
  const entertainment = primaryNavigation.find((item) => item.featureKey === 'ENTERTAINMENT')
  assert.equal(prescription?.href, '/games/daily-prescription')
  assert.equal(prescription?.showInCenter, true)
  assert.equal(prescription?.showInQuickNavigation, true)
  assert.equal(prescription?.activePrefixes.includes('/prescription/history'), true)
  assert.equal(isAppNavigationActive('/games/daily-prescription', entertainment!), false)
  assert.equal(isAppNavigationActive('/games/daily-prescription', {
    ...entertainment!,
    featureKey: 'DAILY_PRESCRIPTION',
    activePrefixes: prescription?.activePrefixes,
  }), true)
  assert.match(read('components/layout/AppShell.tsx'), /daily-prescription.*return false/)
})

test('每日处方页面复用每日挂号的平面容器、语义主题变量和移动端布局', () => {
  const styles = read('app/globals.css')
  const history = read('app/prescription/history/page.tsx')
  assert.match(styles, /\.daily-prescription-panel \{[\s\S]*border:1px solid var\(--border\)/)
  assert.match(styles, /\.daily-prescription-panel>button[\s\S]*var\(--primary\)/)
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.daily-prescription-page-heading/)
  assert.match(styles, /:root\[data-theme='midnight'\]/)
  assert.match(history, /site-page-main flat-page daily-prescription-page prescription-history-page/)
  assert.doesNotMatch(history, /className="entertainment-page|className="entertainment-heading/)
})

test('每日处方领取 API、历史入口和奖励服务仍然存在，未改动数据功能边界', () => {
  assert.equal(existsSync('app/api/entertainment/daily-draw/route.ts'), true)
  assert.match(read('components/games/DailyPrescriptionDetail.tsx'), /href="\/prescription\/history"/)
  assert.match(read('lib/entertainment.ts'), /findExistingDraw\(userId, dateKey\)/)
  assert.match(read('lib/daily-prescription-reward.ts'), /generateDailyPrescriptionReward/)
})
