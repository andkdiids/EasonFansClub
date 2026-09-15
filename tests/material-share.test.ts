import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createMaterialShareCardData,
  materialSharePreview,
  materialShareUrl,
  MATERIAL_SHARE_MESSAGE_TYPE,
  MATERIAL_SHARE_TARGET_TYPE,
  parseMaterialShareSnapshot,
} from '@/lib/material-share-types'

const read = (file: string) => readFileSync(file, 'utf8')

test('物料分享使用独立的 MATERIAL target/message 类型，并保留稳定详情 URL', () => {
  assert.equal(MATERIAL_SHARE_MESSAGE_TYPE, 'MATERIAL_SHARE')
  assert.equal(MATERIAL_SHARE_TARGET_TYPE, 'MATERIAL')
  assert.equal(materialShareUrl('material/1'), '/material-redemptions/material%2F1')
  assert.equal(materialSharePreview({ title: '应援贴纸' }), '[物料] 应援贴纸')
  assert.equal(parseMaterialShareSnapshot({ targetType: 'MATERIAL', materialId: 'm1', title: '物料', summary: '说明' })?.statusLabel, '')
  assert.equal(parseMaterialShareSnapshot({ targetType: 'POST', materialId: 'm1', title: '物料' }), null)
})

test('物料列表与详情使用统一 ShareButton/ShareCardData，并且复制链接指向具体物料', () => {
  const list = read('app/material-redemptions/MaterialRedemptionsClient.tsx')
  const detail = read('app/material-redemptions/[materialId]/MaterialRedemptionDetailClient.tsx')
  const button = read('components/share/ShareButton.tsx')
  const sheet = read('components/share/PostShareSheet.tsx')
  assert.match(list, /<ShareButton[\s\S]*createMaterialShareCardData\(material\)/)
  assert.match(detail, /<ShareButton data=\{shareCardData\}/)
  assert.match(button, /data\.type === 'material'/)
  assert.match(button, /copyText\(canonicalShareUrl\(data\.url\)\)/)
  assert.match(sheet, /materialShareEndpoint/)
  assert.match(sheet, /最近聊天好友/)
  assert.match(sheet, /生成分享卡片/)
  assert.match(sheet, /复制链接/)
})

test('物料好友消息、分享卡片 API 和历史失效状态都接入现有系统', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260915100000_add_material_share_message/migration.sql')
  const sendRoute = read('app/api/material-redemptions/[materialId]/share/route.ts')
  const messagesRoute = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  const dock = read('components/FriendDock.tsx')
  const cardService = read('lib/share-card-service.ts')
  const middleware = read('middleware.ts')
  assert.match(schema, /MATERIAL_SHARE/)
  assert.match(migration, /'MATERIAL_SHARE'/)
  assert.match(sendRoute, /type: MATERIAL_SHARE_MESSAGE_TYPE/)
  assert.match(sendRoute, /metadata: input\.snapshot/)
  assert.match(sendRoute, /recordContentShareTask\(tx, input\.senderId, input\.now\)/)
  assert.match(messagesRoute, /resolveMaterialShareViews\(ordered, user\.id\)/)
  assert.match(dock, /message\.type === 'MATERIAL_SHARE'/)
  assert.match(dock, /查看物料/)
  assert.match(cardService, /loadMaterialShareCardData/)
  assert.match(cardService, /'material'/)
  assert.match(middleware, /api\\\/material-redemptions\\\/\[\^\/\]\+\\\/share-card/)
})

test('无图物料仍生成统一无图 fallback 数据', () => {
  const data = createMaterialShareCardData({
    id: 'material-1',
    title: '无图物料',
    description: '一份说明',
    coverImageUrl: null,
    stateLabel: '兑换结束',
    cost: 0,
  })
  assert.equal(data.type, 'material')
  assert.equal(data.image, null)
  assert.equal(data.url, 'https://ecfc.fans/material-redemptions/material-1')
})
