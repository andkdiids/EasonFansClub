import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getStorePackOrderBy } from '../lib/sticker-center'

const read = (path: string) => readFileSync(path, 'utf8')

test('热门表情包按合集下载记录全局降序并使用稳定次级排序', () => {
  assert.deepEqual(getStorePackOrderBy('hot'), [
    { UserStickerPack: { _count: 'desc' } },
    { createdAt: 'desc' },
    { id: 'desc' },
  ])
})

test('最新和官方分类不改用热门下载排序，分页发生在数据库排序之后', () => {
  assert.deepEqual(getStorePackOrderBy('new'), { createdAt: 'desc' })
  assert.deepEqual(getStorePackOrderBy('official'), { createdAt: 'desc' })

  const source = read('lib/sticker-center.ts')
  const queryStart = source.indexOf('prisma.stickerPack.findMany({')
  const orderIndex = source.indexOf('orderBy: getStorePackOrderBy(sort)', queryStart)
  const skipIndex = source.indexOf('skip: (page - 1) * pageSize', queryStart)
  const takeIndex = source.indexOf('take: pageSize', queryStart)

  assert.ok(queryStart >= 0)
  assert.ok(orderIndex > queryStart)
  assert.ok(orderIndex < skipIndex)
  assert.ok(skipIndex < takeIndex)
  assert.doesNotMatch(source.slice(queryStart, source.indexOf('const items =', queryStart)), /agg\.get\(b\.id\)\?\.downloadCount/)
})

test('热门下载量来自 UserStickerPack 而不是 Sticker usageCount', () => {
  const source = read('lib/sticker-center.ts')

  assert.match(source, /UserStickerPack: \{ _count: 'desc' \}/)
  assert.match(source, /downloadCount: g\._count\._all/)
  assert.match(source, /Sticker\.usageCount.*不能用于热门合集排序/)
})
