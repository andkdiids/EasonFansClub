import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { serializePrescriptionUser } from '../lib/entertainment'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日处方卡片使用处方归属用户并移除余额与右上角日期', () => {
  const service = read('lib/entertainment.ts')
  const saveButton = read('components/games/SavePrescriptionButton.tsx')
  const detail = read('components/games/DailyPrescriptionDetail.tsx')
  const history = read('app/prescription/history/page.tsx')

  assert.match(service, /userId: draw\.userId/)
  assert.match(service, /user: serializePrescriptionUser\(draw\.User\)/)
  assert.match(service, /nickname: true/)
  assert.doesNotMatch(service, /username: true/)
  assert.match(service, /Profile\?\.avatarUrl\) \|\| profileImageUrl\(user\.avatarUrl\)/)
  assert.match(saveButton, /user: DailyPrescriptionUser/)
  assert.doesNotMatch(saveButton, /当前挂号费/)
  assert.doesNotMatch(saveButton, /data\.dateKey/)
  assert.match(saveButton, /image\.crossOrigin = 'anonymous'/)
  assert.match(saveButton, /await drawPrescriptionCanvas\(data, readPalette\(theme\)\)/)
  assert.match(saveButton, /UID: \$\{formatUid\(data\.user\.uid\)\}/)
  assert.match(saveButton, /data\.user\.nickname/)
  assert.doesNotMatch(saveButton, /data\.user\.username|user\.username/)
  assert.match(saveButton, /truncateCanvasText/)
  assert.match(detail, /<PrescriptionUserBadge user=\{status\.draw\.user\}/)
  assert.doesNotMatch(detail, /当前挂号费/)
  assert.match(history, /<PrescriptionUserBadge user=\{record\.user\}/)
})

test('历史处方渲染使用当前用户资料并同步到图片生成', () => {
  const service = read('lib/entertainment.ts')
  const detail = read('components/games/DailyPrescriptionDetail.tsx')
  const saveButton = read('components/games/SavePrescriptionButton.tsx')
  const profileForm = read('app/profile/ProfileSettingsForm.tsx')

  assert.match(service, /getPublicUserDisplayName/)
  assert.match(service, /nicknameModerationStatus: true/)
  assert.match(service, /Profile: \{ select: \{ avatarUrl: true, displayName: true, displayNameModerationStatus: true \} \}/)
  assert.match(service, /uid: user\.uid/)
  assert.match(service, /Profile: \{ select: \{ avatarUrl: true, displayName: true, displayNameModerationStatus: true \} \}/)
  assert.match(service, /profileImageUrl\(user\.Profile\?\.avatarUrl\) \|\| profileImageUrl\(user\.avatarUrl\)/)
  assert.match(detail, /cache: 'no-store'/)
  assert.match(detail, /profile-updated/)
  assert.doesNotMatch(read('app/entertainment/EntertainmentCenter.tsx'), /daily-draw|每日处方|每日抽奖/)
  assert.match(saveButton, /loadAvatarImage\(data\.user\.avatarUrl\)/)
  assert.match(saveButton, /data\.user\.nickname/)
  assert.doesNotMatch(detail, /BEIJING TIME · DAILY/)
  assert.doesNotMatch(saveButton, /BEIJING TIME · DAILY/)
  assert.match(profileForm, /new CustomEvent\('profile-updated'/)
})

test('历史处方序列化读取当前公开昵称和头像并保持 UID 不变', () => {
  const rendered = serializePrescriptionUser({
    uid: 230,
    nickname: 'BBB',
    nicknameModerationStatus: 'NORMAL',
    nicknameViolationDisplay: null,
    avatarUrl: 'https://cdn.example.com/old-avatar.png',
    Profile: {
      avatarUrl: 'https://cdn.example.com/current-avatar.png',
      displayName: '旧展示名',
      displayNameModerationStatus: 'NORMAL',
    },
  })

  assert.equal(rendered.nickname, 'BBB')
  assert.equal(rendered.avatarUrl, 'https://cdn.example.com/current-avatar.png')
  assert.equal(rendered.uid, 230)
})

test('处方导出链路只输出新昵称，不把旧登录账号带入卡片数据', () => {
  const rendered = serializePrescriptionUser({
    uid: 231,
    nickname: '新昵称',
    nicknameModerationStatus: 'NORMAL',
    nicknameViolationDisplay: null,
    avatarUrl: null,
    Profile: null,
    username: 'old_internal_name',
  } as Parameters<typeof serializePrescriptionUser>[0] & { username: string })

  assert.equal(rendered.nickname, '新昵称')
  assert.equal('old_internal_name' in rendered, false)
  assert.equal('username' in rendered, false)
})
