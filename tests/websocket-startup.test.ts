import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('production WebSocket entry uses the custom Next HTTP + upgrade server', () => {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
  const server = read('server.ts')

  assert.equal(packageJson.scripts?.['start:server'], 'tsx server.ts')
  assert.ok(server.indexOf("import 'next/dist/server/node-environment'") < server.indexOf("import next from 'next'"))
  assert.match(server, /const server = createServer\(/)
  assert.match(server, /server\.on\('upgrade'/)
  assert.match(server, /websocket\.server\.started/)
  assert.match(server, /websocket\.connection\.open/)
  assert.match(server, /websocket\.connection\.close/)
  assert.match(server, /websocket\.upgrade\.rejected/)
  assert.match(server, /websocket\.error/)
})

test('WebSocket clients back off failures without synchronized retry storms', () => {
  const notification = read('lib/realtime-client.ts')
  const undercover = read('lib/undercover-star-realtime-client.ts')
  const chat = read('lib/undercover-star-chat-realtime-client.ts')
  const duel = read('components/games/GuessSongDuel.tsx')

  assert.match(notification, /reconnectJitterRatio = 0\.2/)
  assert.match(notification, /document\.visibilityState === 'hidden'/)
  assert.match(undercover, /fallbackDelays = \[5_000, 10_000, 15_000, 30_000\]/)
  assert.match(chat, /fallbackDelays = \[5_000, 10_000, 15_000, 30_000\]/)
  assert.match(duel, /duelReconnectDelays = \[1_000, 2_000, 4_000, 8_000, 15_000, 30_000\]/)
  assert.match(duel, /jitteredDuelDelay\(delay\)/)
})
