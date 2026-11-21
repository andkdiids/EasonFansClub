import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the homepage and activity detail use the same activity-backed entry', () => {
  const read = (file: string) => readFileSync(file, 'utf8')
  assert.match(read('app/welcome/page.tsx'), /readMemoirEntry\(undefined, user.id\)/)
  assert.match(read('app/activities/[activityId]/page.tsx'), /readMemoirEntry\(activityId, viewer\?\.id\)/)
  assert.match(read('components/activities/AnnualMemoirEntry.tsx'), /encodeURIComponent\(config.activityId\)/)
  for (const file of ['app/activities/page.tsx', 'app/api/activities/route.ts', 'app/api/forum/discover/route.ts']) {
    assert.match(read(file), /visibleMemoirActivities\(new Date\(\)\)/)
  }
})

test('reservation confirmation uses the existing confirmed POST contract', () => {
  const source = readFileSync('components/activities/AnnualMemoirReserve.tsx', 'utf8')
  assert.match(source, /确认预约/)
  assert.match(source, /method: 'POST'.*confirmed: true/)
  assert.match(source, /router.refresh\(\)/)
})
