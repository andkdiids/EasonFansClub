import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createUUID } from '../lib/utils/uuid'

test('crypto.randomUUID 可用时优先使用浏览器原生实现', () => {
  const expected = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(createUUID({ randomUUID: () => expected }), expected)
})

test('HTTP IP 环境没有 crypto.randomUUID 时仍可生成游戏请求标识', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  })
  try {
    const first = createUUID()
    const second = createUUID()
    assert.match(first, /^[a-z0-9-]{8,100}$/)
    assert.match(second, /^[a-z0-9-]{8,100}$/)
    assert.notEqual(first, second)
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
    else Reflect.deleteProperty(globalThis, 'crypto')
  }
})

test('猜歌游戏创建和播放链路不再直接调用 randomUUID', () => {
  const sources = [
    readFileSync('app/entertainment/guess-song/GuessSongGame.tsx', 'utf8'),
    readFileSync('lib/guess-song-session.ts', 'utf8'),
    readFileSync('lib/guess-song-admin-audio.ts', 'utf8'),
  ]
  for (const source of sources) {
    assert.match(source, /createUUID\(\)/)
    assert.doesNotMatch(source, /(?:crypto\.)?randomUUID\(\)/)
  }
  assert.match(sources[0], /requestKey: createUUID\(\)/)
})
