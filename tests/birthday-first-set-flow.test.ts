import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { decideBirthdaySave, daysForBirthdayMonth, resetInvalidBirthdayDay } from '@/lib/birthday-profile-flow'

const read = (path: string) => readFileSync(path, 'utf8')
const blank = { birthMonth: null, birthDay: null, birthdaySetAt: null }

test('CASE 1: month-only draft does not qualify as a birthday save', () => {
  assert.deepEqual(decideBirthdaySave(blank, { month: 5, day: null }), {
    kind: 'incomplete',
    message: '请选择完整的生日日期',
  })
})

test('CASE 2: day-only draft does not qualify as a birthday save', () => {
  assert.deepEqual(decideBirthdaySave(blank, { month: null, day: 21 }), {
    kind: 'incomplete',
    message: '请选择完整的生日日期',
  })
})

test('CASE 3: a complete draft is still unpersisted until the confirm action', () => {
  assert.deepEqual(decideBirthdaySave(blank, { month: 5, day: 21 }), {
    kind: 'confirm',
    birthday: { month: 5, day: 21 },
  })
  assert.deepEqual(blank, { birthMonth: null, birthDay: null, birthdaySetAt: null })
})

test('CASES 4/5: complete drafts require the explicit confirm flow and cancel keeps the draft', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.match(form, /setBirthdayConfirmation\(birthdayDecision\.birthday\)/)
  assert.match(form, /function cancelBirthdayConfirmation\(\)[\s\S]*setBirthdayConfirmation\(null\)/)
  assert.doesNotMatch(form, /cancelBirthdayConfirmation[\s\S]*setForm\(/)
  assert.match(form, /aria-labelledby="birthday-confirm-title"/)
  assert.match(form, /请确认你的生日为：/)
  assert.match(form, /生日仅可设置一次，确认保存后将无法修改。/)
  assert.match(form, /确认并保存/)
})

test('CASES 6/7: only a successful response updates the persisted lock snapshot', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.match(form, /if \(data\?\.profile\) \{[\s\S]*setPersistedBirthday\(nextBirthday\)/)
  assert.match(form, /catch \(saveError\) \{[\s\S]*setBirthdayConfirmation\(null\)[\s\S]*setError\(/)
  assert.match(form, /finally \{[\s\S]*setIsSaving\(false\)/)
})

test('CASE 8: saving other profile fields with an incomplete birthday omits birthday fields', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.match(form, /await saveProfile\(null, birthdayDecision\.kind === 'incomplete'\)/)
  assert.match(form, /const birthdayPayload = !birthdayConfigured && birthdayToSave\n\s*\? \{ birthMonth: birthdayToSave\.month, birthDay: birthdayToSave\.day \}\n\s*:\s*\{\}/)
})

test('CASE 9: changing to a shorter month clears an invalid draft day', () => {
  assert.equal(resetInvalidBirthdayDay(4, 31), null)
  assert.equal(resetInvalidBirthdayDay(4, 30), 30)
  assert.equal(resetInvalidBirthdayDay(null, 31), 31)
  assert.equal(daysForBirthdayMonth(4), 30)
})

test('CASES 10/11: February 29 is allowed and February 30 is rejected', () => {
  assert.deepEqual(decideBirthdaySave(blank, { month: 2, day: 29 }), {
    kind: 'confirm',
    birthday: { month: 2, day: 29 },
  })
  assert.deepEqual(decideBirthdaySave(blank, { month: 2, day: 30 }), {
    kind: 'incomplete',
    message: '该日期不存在，请重新选择',
  })
})

test('CASE 12: historical birthdays remain locked from the persisted snapshot', () => {
  assert.deepEqual(decideBirthdaySave({ birthMonth: 5, birthDay: 21, birthdaySetAt: null }, { month: 7, day: 15 }), {
    kind: 'locked',
  })
})

test('CASE 13: the API rejects partial birthday payloads before any birthday write', () => {
  const route = read('app/api/users/me/route.ts')
  assert.match(route, /if \(monthEmpty\) return NextResponse\.json\(\{ message: '请选择有效的出生月份' \}/)
  assert.match(route, /if \(dayEmpty\) return NextResponse\.json\(\{ message: '请选择有效的出生日期' \}/)
  assert.match(route, /if \(!isValidBirthdayParts\(\{ month: birthMonthRaw, day: birthDayRaw \}\)\)/)
})

test('CASE 14: birthday first-set remains atomic and concurrent-safe', () => {
  const route = read('app/api/users/me/route.ts')
  const helper = read('lib/birthday-immutability.ts')
  assert.match(route, /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*writeBirthdayOnce\(tx, guard\.user\.id/)
  assert.match(helper, /updateMany\(/)
  assert.match(helper, /birthMonth: null[\s\S]*birthDay: null[\s\S]*birthdaySetAt: null/)
})

test('birthday draft selections are not persisted through browser storage or effects', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.doesNotMatch(form, /localStorage|sessionStorage/)
  const birthdayEffects = [...form.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[([^\]]*)\]\)/g)]
  assert.ok(birthdayEffects.every(([, body, dependencies]) => !/birth(?:day|Month)/i.test(`${body} ${dependencies}`)))
  assert.match(form, /onChange=\{\(event\) => updateBirthdayMonth\(/)
  assert.match(form, /onChange=\{\(event\) => update\('birthDay'/)
})
