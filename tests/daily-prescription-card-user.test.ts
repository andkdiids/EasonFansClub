import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { serializePrescriptionUser } from '../lib/entertainment'

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

test('历史处方渲染使用当前用户资料并同步到图片生成', () => {
  const service = read('lib/entertainment.ts')
  const detail = read('components/games/DailyPrescriptionDetail.tsx')
  const center = read('app/entertainment/EntertainmentCenter.tsx')
  const saveButton = read('components/games/SavePrescriptionButton.tsx')
  const profileForm = read('app/profile/ProfileSettingsForm.tsx')

  assert.match(service, /publicModerationUserName/)
  assert.match(service, /usernameModerationStatus: true/)
  assert.match(service, /username: publicModerationUserName\(user\.username, \[user\.usernameModerationStatus\]\)/)
  assert.match(service, /uid: user\.uid/)
  assert.match(service, /Profile: \{ select: \{ avatarUrl: true \} \}/)
  assert.match(service, /profileImageUrl\(user\.Profile\?\.avatarUrl\) \|\| profileImageUrl\(user\.avatarUrl\)/)
  assert.match(detail, /cache: 'no-store'/)
  assert.match(detail, /profile-updated/)
  assert.match(center, /cache: 'no-store'/)
  assert.match(center, /profile-updated/)
  assert.match(saveButton, /loadAvatarImage\(data\.user\.avatarUrl\)/)
  assert.match(saveButton, /data\.user\.username/)
  assert.doesNotMatch(detail, /BEIJING TIME · DAILY/)
  assert.doesNotMatch(saveButton, /BEIJING TIME · DAILY/)
  assert.match(profileForm, /new CustomEvent\('profile-updated'/)
})

test('历史处方序列化读取当前用户名和头像并保持 UID 不变', () => {
  const rendered = serializePrescriptionUser({
    uid: 230,
    username: 'BBB',
    usernameModerationStatus: 'NORMAL',
    avatarUrl: 'https://cdn.example.com/old-avatar.png',
    Profile: { avatarUrl: 'https://cdn.example.com/current-avatar.png' },
  })

  assert.equal(rendered.username, 'BBB')
  assert.equal(rendered.avatarUrl, 'https://cdn.example.com/current-avatar.png')
  assert.equal(rendered.uid, 230)
})
