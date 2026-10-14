import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { changeTopicWizardEnd, createTopicWizardDraft, toggleTopicWizardPlatform, topicWizardErrors } from '../components/activities/TopicActivityWizardState'
import { normalizeTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { normalizeTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'
import { createWizardId } from '../components/activities/TopicActivityWizardIds'

function validDraft() {
  let draft = toggleTopicWizardPlatform(createTopicWizardDraft(), 'weibo')
  draft.activity.title = '天使的礼物'
  draft.activity.description = '活动介绍'
  draft.activity.participationRule = '发布内容、提交截图并等待审核'
  draft.activity.startsAt = '2030-10-01T09:00'
  draft = changeTopicWizardEnd(draft, '2030-10-10T18:00')
  draft.lottery.enabled = true
  draft.lottery.drawAt = '2030-10-11T18:00'
  draft.lottery.addressDeadline = '2030-10-18T18:00'
  draft.lottery.prizes = [{ id: createWizardId('prize'), name: '活动礼物', description: '', imageUrl: null, quantity: 3, sortOrder: 0 }]
  return draft
}

test('wizard defaults reuse TOPIC_ACTIVITY, keep lottery optional and advanced modules off', () => {
  const draft = createTopicWizardDraft()
  assert.equal(draft.activity.type, 'TOPIC_ACTIVITY')
  assert.equal(draft.activity.participationMode, 'COMMENT')
  assert.equal(draft.activity.allowImageAttachments, true)
  assert.equal(draft.lottery.enabled, false)
  for (const section of [draft.program.poll, draft.program.test, draft.program.fixedReward, draft.program.medal]) assert.equal(section.enabled, false)
  assert.equal(normalizeTopicActivityV2Program(draft.program).valid, true)
})
test('wizard local drafts never share mutable module state', () => {
  const first = createTopicWizardDraft(), second = createTopicWizardDraft()
  first.program.test.questions.push({ id: 'one', prompt: 'test', points: 1, options: [] })
  assert.equal(second.program.test.questions.length, 0)
})
test('wizard task IDs remain stable and duplicate platforms do not accumulate', () => {
  const first = toggleTopicWizardPlatform(createTopicWizardDraft(), 'weibo')
  const id = first.program.entries[0].id
  const second = toggleTopicWizardPlatform(first, 'xiaohongshu')
  assert.equal(second.program.entries[0].id, id)
  const removed = toggleTopicWizardPlatform(second, 'weibo')
  assert.deepEqual(removed.lottery.sourceEntryIds, [first.identity.platformTaskIds.xiaohongshu])
  const readded = toggleTopicWizardPlatform(removed, 'weibo')
  assert.equal(readded.program.entries.find((entry) => entry.platformKey === 'weibo')?.id, id)
  assert.equal(new Set(readded.lottery.sourceEntryIds).size, 2)
})
test('wizard medal trigger follows actual participation source after task changes', () => {
  const draft = validDraft()
  draft.program.medal.enabled = true
  assert.deepEqual(toggleTopicWizardPlatform(draft, 'weibo').program.medal.triggers, ['APPROVED_COMMENT'])
})
test('wizard inherits eligibility deadline from the single activity end input', () => {
  const draft = changeTopicWizardEnd(validDraft(), '2030-10-12T18:00')
  assert.equal(draft.lottery.eligibilityDeadline, draft.activity.endsAt)
  assert.ok(topicWizardErrors(draft, 3).includes('开奖时间不能早于活动结束／资格截止'))
})
test('wizard valid screenshot task and lottery draft matches existing DTO normalizers', () => {
  const draft = validDraft()
  assert.deepEqual(topicWizardErrors(draft, 3), [])
  assert.equal(normalizeTopicActivityV2Program(draft.program).valid, true)
  assert.equal(normalizeTopicLotteryConfig(draft.lottery).eligibilityDeadline, '2030-10-10T10:00:00.000Z')
})
test('wizard ordinary topic discussion is valid without lottery or platform', () => {
  const draft = validDraft()
  const withoutPlatform = toggleTopicWizardPlatform(draft, 'weibo')
  withoutPlatform.lottery.enabled = false
  assert.deepEqual(topicWizardErrors(withoutPlatform, 3), [])
})
test('wizard lottery cannot turn ordinary approved discussion into an eligible source', () => {
  const draft = toggleTopicWizardPlatform(validDraft(), 'weibo')
  assert.ok(topicWizardErrors(draft, 3).some((error) => error.includes('普通讨论评论')))
})
test('wizard disabled screenshot attachment blocks platform tasks', () => {
  const draft = validDraft()
  draft.activity.allowImageAttachments = false
  assert.ok(topicWizardErrors(draft, 1).some((error) => error.includes('图片附件')))
})
test('wizard unknown or deselected source cannot pass final checks', () => {
  const draft = validDraft()
  draft.lottery.sourceEntryIds = ['unknown-entry']
  assert.ok(topicWizardErrors(draft, 3).includes('请选择有效的平台截图任务作为资格来源'))
})
for (const count of [0, -1, 1.5, 1001, Number.NaN]) test(`wizard rejects invalid prize quantity ${count}`, () => {
  const draft = validDraft()
  draft.lottery.prizes[0].quantity = count
  assert.ok(topicWizardErrors(draft, 2).some((error) => error.includes('奖品数量')))
})
test('wizard total inventory limit preserved', () => {
  const draft = validDraft()
  draft.lottery.prizes[0].quantity = 1000
  draft.lottery.prizes.push({ ...draft.lottery.prizes[0], id: 'two', quantity: 1 })
  assert.ok(topicWizardErrors(draft, 2).includes('奖品总数不能超过 1000 件'))
})
test('wizard rejects wrong activity, draw and address time relationships', () => {
  const draft = validDraft()
  draft.activity.startsAt = '2030-10-12T09:00'
  draft.lottery.drawAt = '2030-10-09T18:00'
  draft.lottery.addressDeadline = '2030-10-09T18:00'
  assert.equal(topicWizardErrors(draft, 3).filter((error) => error.includes('时间') || error.includes('截止')).length, 3)
})
test('wizard screenshot bounds and whole-number point rewards checked', () => {
  const draft = validDraft()
  draft.program.entries[0].maxImages = 0
  draft.program.entries[0].points = -1
  assert.equal(topicWizardErrors(draft, 3).length, 2)
})
test('wizard guards missing required fields and badge selection', () => {
  const draft = createTopicWizardDraft()
  draft.program.medal.enabled = true
  assert.equal(topicWizardErrors(draft, 3).length, 5)
})
test('wizard delegates base draft transport, with no publish or upload entry point', () => {
  for (const name of ['TopicActivityWizard.tsx', 'TopicActivityWizardSummary.tsx', 'TopicActivityWizardState.ts']) {
    const source = readFileSync(`components/activities/${name}`, 'utf8')
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|uploadActivityImage|localStorage|sessionStorage|prisma|\/api\//)
  }
  const manager = readFileSync('app/admin/activities/ActivityAdminManager.tsx', 'utf8')
  assert.ok(manager.includes('创建话题活动'))
  assert.ok(manager.includes('<TopicActivityWizard'))
  const wizard = readFileSync('components/activities/TopicActivityWizard.tsx', 'utf8')
  assert.ok(wizard.includes('saveWizardActivityDraft'))
  assert.ok(wizard.includes('创建话题活动草稿'))
  assert.ok(wizard.includes('刷新会丢失页面会话'))
  assert.doesNotMatch(wizard, /模拟发布检查|simulateSave/)
  assert.doesNotMatch(wizard, /分享抽奖活动|测试版本|海报宽度/)
})
