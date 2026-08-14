import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日处方卡片使用处方归属用户并移除余额与右上角日期', () => {
  const service = read('lib/entertainment.ts')
  const saveButton = read('components/games/SavePrescriptionButton.tsx')
  const center = read('app/entertainment/EntertainmentCenter.tsx')
  const history = read('app/prescription/history/page.tsx')

  assert.match(service, /userId: draw\.userId/)
  assert.match(service, /user: serializePrescriptionUser\(draw\.User\)/)
  assert.match(service, /Profile\?\.avatarUrl\) \|\| profileImageUrl\(user\.avatarUrl\)/)
  assert.match(saveButton, /user: DailyPrescriptionUser/)
  assert.doesNotMatch(saveButton, /当前挂号费/)
  assert.doesNotMatch(saveButton, /data\.dateKey/)
  assert.match(saveButton, /image\.crossOrigin = 'anonymous'/)
  assert.match(saveButton, /await drawPrescriptionCanvas\(data, readPalette\(theme\)\)/)
  assert.match(saveButton, /UID: \$\{formatUid\(data\.user\.uid\)\}/)
  assert.match(saveButton, /truncateCanvasText/)
  assert.match(center, /<PrescriptionUserBadge user=\{drawResult\.user\}/)
  assert.doesNotMatch(center, /当前挂号费/)
  assert.match(history, /<PrescriptionUserBadge user=\{record\.user\}/)
})
