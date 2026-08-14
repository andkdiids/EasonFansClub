import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  filterPhoneCountries,
  getPhoneInputParts,
  getPhoneLookupVariants,
  normalizePhoneNumber,
} from '../lib/phone-number'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('中国大陆手机号统一保存为 E.164，同时兼容历史本地号回查', () => {
  const normalized = normalizePhoneNumber('138 0013 8000', 'CN')
  assert.equal(normalized?.e164, '+8613800138000')
  assert.deepEqual(getPhoneLookupVariants('13800138000', 'CN'), ['+8613800138000', '13800138000'])
})

test('国际手机号按所选国家/地区解析并可从完整号码自动识别', () => {
  assert.equal(normalizePhoneNumber('9123 4567', 'HK')?.e164, '+85291234567')
  assert.equal(normalizePhoneNumber('+886 912 345 678', 'CN')?.e164, '+886912345678')
  assert.equal(getPhoneInputParts('+852 9123 4567').country, 'HK')
  assert.equal(getPhoneInputParts('+852 9123 4567').value, '91234567')
})

test('个人资料编辑复用同一套国际手机号拆分、标准化和历史号码兼容规则', () => {
  assert.deepEqual(getPhoneInputParts('+8613812345678'), { country: 'CN', value: '13812345678' })
  assert.deepEqual(getPhoneInputParts('13812345678'), { country: 'CN', value: '13812345678' })
  assert.equal(normalizePhoneNumber('13912345678', 'CN')?.e164, '+8613912345678')
  assert.equal(normalizePhoneNumber('91234567', 'HK')?.e164, '+85291234567')
  assert.equal(normalizePhoneNumber('7911123456', 'GB')?.e164, '+447911123456')
  assert.deepEqual(getPhoneLookupVariants('+8613812345678', 'CN'), ['+8613812345678', '13812345678'])
})

test('常用国家/地区号码均可通过同一解析器校验', () => {
  const fixtures = [
    ['CN', '13800138000'],
    ['HK', '91234567'],
    ['MO', '62123456'],
    ['TW', '912345678'],
    ['US', '2025550123'],
    ['GB', '7911123456'],
    ['JP', '9012345678'],
    ['SG', '81234567'],
  ] as const
  for (const [country, value] of fixtures) assert.ok(normalizePhoneNumber(value, country), `${country} fixture should be valid`)
})

test('国家/地区选择器支持中文、英文、区号和加号搜索', () => {
  assert.ok(filterPhoneCountries('香港').some((country) => country.code === 'HK'))
  assert.ok(filterPhoneCountries('Hong Kong').some((country) => country.code === 'HK'))
  assert.ok(filterPhoneCountries('+852').some((country) => country.code === 'HK'))
  assert.ok(filterPhoneCountries('86').some((country) => country.code === 'CN'))
})

test('注册和登录页面复用共享手机号选择器，服务端不再固定中国大陆 11 位正则', () => {
  const register = source('app/register/RegisterForm.tsx')
  const login = source('app/login/LoginForm.tsx')
  const prepare = source('app/api/auth/register/prepare/route.ts')
  const complete = source('app/api/auth/register/route.ts')
  const loginRoute = source('app/api/auth/login/route.ts')
  const users = source('lib/users.ts')

  assert.match(register, /InternationalPhoneInput/)
  assert.match(register, /phoneCountry/)
  assert.match(login, /InternationalPhoneInput/)
  assert.match(login, /phoneCountry/)
  assert.match(prepare, /normalizePhoneNumber/)
  assert.match(complete, /normalizePhoneNumber/)
  assert.match(loginRoute, /normalizePhoneNumber/)
  assert.match(users, /getPhoneLookupVariants/)
  for (const route of [prepare, complete, loginRoute]) assert.doesNotMatch(route, /\^1\\d\{10\}\$/)
})

test('注册和登录共享紧凑区号触发器，且展开面板保留足够宽度', () => {
  const selector = source('components/InternationalPhoneInput.tsx')
  assert.match(selector, /relative w-\[72px\] shrink-0/)
  assert.match(selector, /h-11 w-full min-w-0[^\n]*px-2\.5[^\n]*pr-6/)
  assert.match(selector, /absolute right-2 top-1\/2/)
  assert.match(selector, /w-\[min\(280px,calc\(100vw-2rem\)\)\]/)
})

test('编辑资料手机号使用对齐的紧凑区号列，并优先向上展开且不撑开布局', () => {
  const selector = source('components/InternationalPhoneInput.tsx')
  const profile = source('app/profile/ProfileSettingsForm.tsx')
  const styles = source('app/globals.css')

  assert.match(selector, /containerClassName\?: string/)
  assert.match(selector, /countryContainerClassName\?: string/)
  assert.match(selector, /dropdownPlacement\?: 'auto' \| 'top' \| 'bottom'/)
  assert.match(selector, /data-placement=\{dropdownSide\}/)
  assert.match(selector, /className=\{`\$\{containerClassName \|\| 'mt-1'\} flex min-w-0 items-stretch gap-2`\}/)
  assert.match(profile, /containerClassName="profile-phone-input mt-3"/)
  assert.match(profile, /countryContainerClassName="profile-phone-country"/)
  assert.match(profile, /dropdownPlacement="top"/)
  assert.doesNotMatch(profile, /inputClassName="mt-3"/)
  assert.match(styles, /\.profile-phone-input \.profile-phone-country \{ width:88px; \}/)
  assert.match(styles, /\.phone-country-options\[data-placement='top'\][^{]*\{[^}]*top:auto; bottom:calc\(100% \+ 4px\)/)
  assert.match(styles, /\.phone-country-options \{[^}]*max-height:min\(360px,calc\(100dvh - 9rem\)\)/)
})
