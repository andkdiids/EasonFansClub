import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  addRecentExpression,
  createRecentEmoji,
  createRecentSticker,
  hydrateRecentExpressions,
  MAX_RECENT_EXPRESSIONS,
  readRecentExpressions,
  RECENT_EXPRESSIONS_STORAGE_KEY,
  recentExpressionKey,
  type RecentExpression,
  writeRecentExpressions,
} from '@/lib/recent-expressions'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const sticker = (id: string) => createRecentSticker({
  id,
  name: id,
  url: `https://cdn.example.test/${id}.webp`,
  type: 'STATIC',
})

test('最近使用统一混排，并按 Emoji value / sticker id 去重移到队首', () => {
  let recent = addRecentExpression([], createRecentEmoji('😂'))
  recent = addRecentExpression(recent, sticker('sticker-a'))
  recent = addRecentExpression(recent, createRecentEmoji('❤️'))
  recent = addRecentExpression(recent, createRecentEmoji('😂'))
  recent = addRecentExpression(recent, sticker('sticker-a'))

  assert.deepEqual(recent.map(recentExpressionKey), [
    'sticker:sticker-a',
    'emoji:😂',
    'emoji:❤️',
  ])
  assert.deepEqual(recent.map((item) => item.type), ['sticker', 'emoji', 'emoji'])
})

test('最近使用达到上限时淘汰最旧项', () => {
  const recent = Array.from({ length: MAX_RECENT_EXPRESSIONS + 3 }, (_, index) => createRecentEmoji(`emoji-${index}`))
    .reduce<RecentExpression[]>((items, item) => addRecentExpression(items, item), [])

  assert.equal(recent.length, MAX_RECENT_EXPRESSIONS)
  assert.equal(recent[0].type, 'emoji')
  if (recent[0].type === 'emoji') assert.equal(recent[0].value, `emoji-${MAX_RECENT_EXPRESSIONS + 2}`)
  const oldest = recent.at(-1)
  if (oldest?.type === 'emoji') assert.equal(oldest.value, 'emoji-3')
})

test('旧 localStorage 表情包记录可迁移并由可见 sticker 数据补全', () => {
  const storage = new MemoryStorage()
  storage.setItem(RECENT_EXPRESSIONS_STORAGE_KEY, JSON.stringify([
    { stickerId: 'legacy-sticker' },
    { type: 'emoji', value: '😭' },
  ]))
  storage.setItem('recentStickers', JSON.stringify([{ stickerId: 'legacy-sticker-2' }]))
  storage.setItem('recentEmojis', JSON.stringify(['👍']))

  const read = readRecentExpressions(storage)
  assert.deepEqual(read.map((item) => item.type), ['sticker', 'emoji', 'sticker', 'emoji'])

  const hydrated = hydrateRecentExpressions(read, [{
    id: 'legacy-sticker',
    name: '旧表情',
    url: '/media/legacy.webp',
    type: 'GIF',
  }])
  assert.deepEqual(hydrated[0], {
    type: 'sticker',
    id: 'legacy-sticker',
    url: '/media/legacy.webp',
    name: '旧表情',
    stickerType: 'GIF',
  })

  writeRecentExpressions(hydrated, storage)
  const persisted = JSON.parse(storage.getItem(RECENT_EXPRESSIONS_STORAGE_KEY) || '[]') as Array<{ type: string }>
  assert.equal(persisted.every((item) => item.type === 'emoji' || item.type === 'sticker'), true)
})

test('选择器的 Emoji 与表情包入口都接入统一最近使用更新', () => {
  const picker = readFileSync('components/StickerPicker.tsx', 'utf8')
  assert.match(picker, /const updateRecentExpressions = useCallback/)
  assert.match(picker, /updateRecentExpressions\(createRecentEmoji\(emoji\)\)/)
  assert.match(picker, /updateRecentExpressions\(createRecentSticker\(sticker\)\)/)
  assert.match(picker, /recent: RecentExpression\[\]/)
  assert.match(picker, /onClick=\{\(\) => onSelectEmoji\(expression\.value\)\}/)
})
