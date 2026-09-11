import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSalonPostContext, getSalonPostDisplayTitle, getSalonPostMetadata } from '@/lib/salon-shared'

const concert = {
  id: 'concert-1',
  title: '合肥站',
  date: '2024-12-29T00:00:00.000Z',
  city: '合肥',
  stageType: 'STANDARD',
  venue: null,
  sessionNumber: '3',
  tour: { id: 'tour-1', name: 'Fear and Dreams' },
} as const

test('沙龙用户标题始终优先于分类、演唱会和场次 metadata', () => {
  assert.equal(getSalonPostDisplayTitle({ title: '这一场真的拍到了很喜欢的一张', content: '正文内容' }), '这一场真的拍到了很喜欢的一张')
  assert.equal(getSalonPostMetadata('CONCERT', concert), '演唱会记录 · Fear and Dreams · 合肥站 · 2024/12/29 · 3')
  assert.equal(formatSalonPostContext('CONCERT', concert), getSalonPostMetadata('CONCERT', concert))
})

test('历史空标题使用正文第一段，再退回通用沙龙标题', () => {
  assert.equal(getSalonPostDisplayTitle({ title: '  ', content: '第一段说明\n仍属于第一段\n\n第二段' }), '第一段说明 仍属于第一段')
  assert.equal(getSalonPostDisplayTitle({ title: null, content: null }), '沙龙分享')
  assert.equal(getSalonPostMetadata('MOBILE_WALLPAPER', null), '手机壁纸')
  assert.doesNotMatch(getSalonPostMetadata('CONCERT', { ...concert, title: null, city: '', sessionNumber: null }), /undefined|null|·\s*·/)
})
