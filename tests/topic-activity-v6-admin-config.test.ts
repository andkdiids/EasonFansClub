import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeTopicActivityConfig } from '@/lib/topic-activity-config'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

test('V6 活动设置提供中文评论门槛与次数，BOTH 不再暗示表单可选', () => {
  const admin = read('app/admin/activities/ActivityAdminManager.tsx')
  for (const label of ['表单提交后何时允许评论？', '提交表单后立即允许评论', '管理员回复表单后才允许评论', '参与评论次数', '不限次数', '每位用户仅可评论一次']) assert.ok(admin.includes(label), label)
  assert.match(admin, /form\.formSchema\.commentPolicy\?\.gateMode/)
  assert.match(admin, /form\.formSchema\.commentPolicy\?\.commentLimit/)
  assert.match(admin, /删除或撤回不会恢复；楼中楼回复不计入/)
  for (const file of ['app/admin/activities/ActivityAdminManager.tsx', 'components/activities/ActivityDetailView.tsx', 'app/posts/[postId]/page.tsx']) {
    assert.ok(read(file).includes('表单与评论，评论为最终凭证'))
    assert.ok(!read(file).includes('选填表单，评论为最终凭证'))
  }
})

test('V6 评论策略写入现有 formSchema JSON，编辑其他设置不重置策略', () => {
  const config = normalizeTopicActivityConfig({
    participationMode: 'BOTH',
    formSchema: { version: 1, fields: [{ id: 'name', label: '资料', type: 'TEXT' }], commentPolicy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' } },
  }, 'TOPIC_ACTIVITY')
  assert.equal(config.valid, true)
  if (!config.valid) return
  assert.deepEqual(config.value.formSchema.commentPolicy, { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'SINGLE' })
  const edited = normalizeTopicActivityConfig({ participationRule: '补充说明' }, 'TOPIC_ACTIVITY', config.value)
  assert.equal(edited.valid, true)
  if (edited.valid) assert.deepEqual(edited.value.formSchema.commentPolicy, config.value.formSchema.commentPolicy)
  assert.match(read('components/activities/TopicActivityFormDesigner.tsx'), /onSchemaChange\(\{ \.\.\.schema, fields:/)
})
