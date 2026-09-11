import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('活动后台创建表单默认收起，并提供独立的创建入口', () => {
  const manager = read('app/admin/activities/ActivityAdminManager.tsx')
  assert.match(manager, /const \[createFormOpen, setCreateFormOpen\] = useState\(false\)/u)
  assert.match(manager, /function toggleCreateForm\(\)/u)
  assert.match(manager, /onClick=\{toggleCreateForm\}/u)
  assert.match(manager, /createFormOpen \|\| editingId \? <form/u)
  assert.match(manager, /activityFormRef\.current\?\.scrollIntoView/u)
  assert.match(manager, /activityTitleInputRef\.current\?\.focus/u)
  assert.match(manager, /if \(creating\) focusActivityList\(\)/u)
})

test('报名管理和活动通知按活动定位，并在渲染后滚动到展开区域', () => {
  const manager = read('app/admin/activities/ActivityAdminManager.tsx')
  assert.match(manager, /type ActivityManagementSection = 'registrations' \| 'notifications'/u)
  assert.match(manager, /openManagementSection\(activity\.id, 'registrations'\)/u)
  assert.match(manager, /openManagementSection\(activity\.id, 'notifications'\)/u)
  assert.match(manager, /setRegistrationActivityId\(activityId\)/u)
  assert.match(manager, /setNotificationActivityId\(activityId\)/u)
  assert.match(manager, /managementSectionRefs\.current\[`\$\{registrationActivityId\}:registrations`\]/u)
  assert.match(manager, /managementSectionRefs\.current\[`\$\{notificationActivityId\}:notifications`\]/u)
  assert.match(manager, /window\.requestAnimationFrame\(\(\) => \{/u)
  assert.match(manager, /target\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/u)
  assert.match(manager, /grid grid-cols-2 gap-2 md:flex/u)
})
