import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { createTopicWizardDraft, topicWizardErrors } from '@/components/activities/TopicActivityWizardState'
import { createWizardMedia } from '@/components/activities/TopicActivityWizardMedia'
import { createWizardSnapshot } from '@/components/activities/TopicActivityWizardSession'
import { prepareWizardActivityPayload } from '@/components/activities/TopicActivityWizardPayload'
import { getTopicWizardEditChanges, saveTopicWizardEdits, topicWizardEditInitialState } from '@/components/activities/TopicActivityWizardEdit'
import { verifyWizardActivityReadback } from '@/components/activities/TopicActivityWizardActivitySave'

function creation() {
  const draft = createTopicWizardDraft()
  Object.assign(draft.activity, { title: '本地话题', description: '介绍', participationRule: '提交参与内容', startsAt: '2026-11-01T12:00', endsAt: '2026-11-02T12:00' })
  return { draft, media: createWizardMedia() }
}
test('wizard scheduled payload uses existing Activity fields and exact Asia/Shanghai instant', () => {
  const { draft, media } = creation()
  Object.assign(draft.activity, { rewardGrantMode: 'SCHEDULED', rewardGrantAt: '2026-11-03T20:00' })
  const payload = prepareWizardActivityPayload(createWizardSnapshot(draft, media, 4))
  assert.equal(payload.rewardGrantMode, 'SCHEDULED')
  assert.equal(payload.rewardGrantAt, '2026-11-03T12:00:00.000Z')
  assert.equal('rewardTiming' in payload, false)
  assert.throws(() => verifyWizardActivityReadback({ ...payload, id: 'activity-one', rewardGrantMode: 'IMMEDIATE' }, 'activity-one', payload), /回读内容不一致/)
  verifyWizardActivityReadback({ ...payload, id: 'activity-one' }, 'activity-one', payload)
})
test('scheduled time is required; immediate payload clears a previous schedule', () => {
  const { draft, media } = creation()
  draft.activity.rewardGrantMode = 'SCHEDULED'
  assert.ok(topicWizardErrors(draft, 3).some((error) => error.includes('统一发奖时间')))
  assert.throws(() => prepareWizardActivityPayload(createWizardSnapshot(draft, media, 4)), /统一发奖时间/)
  draft.activity.rewardGrantMode = 'IMMEDIATE'; draft.activity.rewardGrantAt = '2026-11-03T20:00'
  assert.equal(prepareWizardActivityPayload(createWizardSnapshot(draft, media, 4)).rewardGrantAt, null)
})

test('existing scheduled activity hydrates without dirty defaults; timing-only edit saves and reads back without program writes', async () => {
  let activity: Record<string, unknown> = { id: 'activity-edit', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', title: '已发布', description: '介绍', coverUrl: null,
    startsAt: null, endsAt: null, participationMode: 'COMMENT', participationRule: null, allowImageAttachments: true,
    rewardGrantMode: 'SCHEDULED', rewardGrantAt: '2026-11-03T12:00:00.000Z' }
  const program = createDefaultTopicActivityV2Program()
  const initial = () => topicWizardEditInitialState({ activity }, { program }, { config: null }, 'activity-edit')
  const f = initial()
  assert.equal(f.draft.activity.rewardGrantAt, '2026-11-03T20:00')
  assert.deepEqual(getTopicWizardEditChanges(f.baseline, f.draft, f.media).activityPatch, {})
  f.draft.activity.rewardGrantAt = '2026-11-04T20:00'
  const calls: string[] = []
  const saved = await saveTopicWizardEdits({ activityId: 'activity-edit', baseline: f.baseline, draft: f.draft, media: f.media,
    transport: async (path, init) => {
      calls.push((init.method || 'GET') + ' ' + path)
      assert.equal(path, '/api/admin/activities/activity-edit')
      if (init.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>
        assert.deepEqual(patch, { rewardGrantAt: '2026-11-04T12:00:00.000Z' })
        activity = { ...activity, ...patch }
      }
      return new Response(JSON.stringify({ activity }), { status: 200 })
    } })
  assert.equal(saved.status, 'SAVED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
  const reloaded = initial()
  assert.deepEqual(getTopicWizardEditChanges(reloaded.baseline, reloaded.draft, reloaded.media).activityPatch, {})
  reloaded.draft.activity.rewardGrantMode = 'IMMEDIATE'
  assert.deepEqual(getTopicWizardEditChanges(reloaded.baseline, reloaded.draft, reloaded.media).activityPatch, { rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null })
})
