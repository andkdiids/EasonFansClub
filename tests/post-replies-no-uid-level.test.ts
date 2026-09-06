import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const replySection = read('components/PostRepliesSection.tsx')
const postList = read('components/PostList.tsx')
const publicUserModules = read('components/PublicUserModules.tsx')

const visibleUidCount = (replySection.match(/UID \{formatUid\(reply\.author\.uid\)\}/g) || []).length
const visibleLvCount = (replySection.match(/Lv\.\{reply\.author\.level\}/g) || []).length
const nicknameLinkCount = (replySection.match(/<Link href=\{`\/user\/\$\{formatUid\(reply\.author\.uid\)\}`\}/g) || []).length
const ipLabelCount = (replySection.match(/<IpRegionLabel ipRegion=\{reply\.ipRegion\} \/>/g) || []).length

test('帖子回复列表一级评论不渲染可见 UID', () => {
  assert.equal(visibleUidCount, 0)
  assert.doesNotMatch(replySection, /· UID \{formatUid/)
})

test('帖子回复列表楼中楼回复不渲染可见 UID', () => {
  assert.doesNotMatch(replySection, /<span className="font-bold text-slate-400">UID \{formatUid/)
})

test('帖子回复列表一级评论与楼中楼均不渲染 Lv. 等级', () => {
  assert.equal(visibleLvCount, 0)
  assert.doesNotMatch(replySection, /· Lv\.\{reply\.author\.level\}/)
})

test('回复作者仍可点击跳转个人主页并保留头像', () => {
  // 楼中楼：头像 Link + 昵称 Link；一级评论：头像与昵称共用一个 Link。
  assert.ok(nicknameLinkCount >= 3)
  const avatarCount = (replySection.match(/<SafeAvatar src=\{avatar\} name=\{name\} uid=\{reply\.author\.uid\} \/>/g) || []).length
  assert.equal(avatarCount, 2)
})

test('昵称与已佩戴勋章展示保留（两级评论共用 UserDisplayName）', () => {
  const displayNames = (replySection.match(/<UserDisplayName name=\{name\} uid=\{reply\.author\.uid\} badges=\{reply\.author\.equippedBadges\} badge=\{reply\.author\.equippedBadge\} compact \/>/g) || []).length
  assert.ok(displayNames >= 2)
})

test('回复时间、IP 属地、楼层、点赞、回复按钮、@回复对象与置顶均保留', () => {
  assert.match(replySection, /formatDate\(new Date\(reply\.createdAt\)\)/)
  assert.equal(ipLabelCount, 2)
  assert.match(replySection, /floorNumber\}楼/)
  assert.match(replySection, /replyLikeButton\(reply\)/)
  assert.match(replySection, /openReplyComposer\(\{ id: reply\.id, name \}\)/)
  assert.match(replySection, /回复 @\{replyToName\}：/)
  assert.match(replySection, /reply\.isPinned \? <span/)
})

test('删除 UID/Lv 后不残留多余分隔点或空占位（时间/IP 仍为独立行元素）', () => {
  assert.doesNotMatch(replySection, /compact \/> · UID/)
  assert.doesNotMatch(replySection, /compact \/> · Lv/)
  assert.doesNotMatch(replySection, /<span className="font-bold text-slate-400"><\/span>/)
})

test('其他业务页面的 UID / 等级展示不受影响（仅移除回复场景）', () => {
  assert.match(postList, /· UID \{formatUid\(post\.author\.uid\)\} · Lv\.\{post\.author\.level\}/)
  assert.match(publicUserModules, /· UID \{formatUid\(author\.uid\)\}/)
  assert.match(read('components/ProfileSummary.tsx'), /profile-identity-uid">UID \{formatUid\(uid\)\}/)
})
