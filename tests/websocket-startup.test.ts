import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('production WebSocket entry uses the custom Next HTTP + upgrade server', () => {
  const packageJson = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const server = read('server.ts')
  const middleware = read('middleware.ts')
  const ecosystem = read('ecosystem.config.js')
  const deployScript = read('scripts/deploy-production-git.sh')
  const deployWorkflow = read('.github/workflows/deploy.yml')

  // The script PM2 invokes is the script this test guards. Keep the old name
  // as a compatibility entry, but require both names to resolve identically.
  assert.equal(packageJson.scripts?.start, 'tsx server.ts')
  assert.equal(packageJson.scripts?.['start:server'], packageJson.scripts?.start)
  assert.doesNotMatch(packageJson.scripts?.start || '', /\bnext\s+start\b/)
  assert.equal(packageJson.dependencies?.tsx, '^4.20.0')
  assert.equal(packageJson.devDependencies?.tsx, undefined)

  assert.match(ecosystem, /name:\s*["']easonfansclub["'][\s\S]*?script:\s*["']npm["'][\s\S]*?args:\s*["']run start["']/)
  assert.match(deployScript, /\[ "\$\{pm2_args\}" = "run start" \]/)
  assert.match(deployWorkflow, /< scripts\/deploy-production-git\.sh/)

  assert.ok(server.indexOf("import 'next/dist/server/node-environment'") < server.indexOf("import next from 'next'"))
  assert.match(server, /const server = createServer\(/)
  assert.match(server, /const websocketServer = new WebSocketServer\(\{[\s\S]*?noServer:\s*true/)
  assert.match(server, /server\.on\('upgrade'/)
  assert.match(server, /server\.on\('upgrade'[\s\S]*?authorizeUpgrade[\s\S]*?websocketServer\.handleUpgrade/)
  assert.match(server, /server\.listen\(port, hostname/)
  assert.match(server, /const hostname = process\.env\.HOST \|\| '127\.0\.0\.1'/)
  assert.match(server, /process\.env\.PORT \|\| 3000/)
  assert.match(server, /const websocketPaths = \[websocketPath, duelWebsocketPath, undercoverWebsocketPath, undercoverChatWebsocketPath\]/)
  for (const path of ['/ws', '/ws/duel', '/ws/undercover', '/ws/undercover-chat']) {
    assert.ok(server.includes(`'${path}'`), `custom server must keep ${path}`)
  }
  const upgradeListener = server.slice(server.indexOf("server.on('upgrade'"))
  assert.doesNotMatch(upgradeListener, /handle\(request, response\)/)
  assert.match(server, /getCurrentUserFromSessionToken/)
  assert.match(server, /hasValidRequestOrigin/)
  assert.match(server, /maxConnectionsPerUser/)
  assert.match(server, /maxConnectionsPerIp/)
  assert.match(server, /maxAttemptsPerIp/)

  // WebSocket upgrades are consumed by Node's upgrade event before the HTTP
  // request handler can enter Next middleware; keep middleware auth intact.
  assert.match(middleware, /function loginRedirect\(/)
  assert.match(middleware, /verifyRequestSession\(/)
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
