import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const surface = read('components/ProfilePageSurface.tsx')
const modules = read('components/PublicUserModules.tsx')
const groups = read('components/ProfilePostGroups.tsx')
const wall = read('components/ProfileWall.tsx')
const recordSettings = read('components/ProfileRecordSettings.tsx')
const badges = read('components/BadgeCollectionPanel.tsx')
const remark = read('components/FriendRemarkEditor.tsx')
const editor = read('app/profile/ProfileEditorDrawer.tsx')
const form = read('app/profile/ProfileSettingsForm.tsx')
const locationPicker = read('components/UserLocationPicker.tsx')
const css = read('app/globals.css')

test('个人主页使用直角容器、边框和主题 token', () => {
  assert.match(surface, /profile-page-surface/)
  assert.match(surface, /profile-action-link inline-flex[\s\S]*rounded-sm/)
  assert.match(surface, /bg-\[var\(--primary\)\]/)
  assert.match(surface, /rounded-none border border-\[var\(--border\)\][\s\S]*shadow-none/)
  assert.doesNotMatch(surface, /rounded-(xl|2xl|3xl)|rounded-\[(24|28)px\]|shadow-(lg|xl|2xl)/)
})

test('主页 tabs、帖子、分组和留言墙不使用大圆角胶囊', () => {
  assert.match(modules, /rounded-none border px-3 py-2/)
  assert.match(modules, /overflow-hidden rounded-none border border-\[var\(--border\)\]/)
  assert.doesNotMatch(modules, /rounded-xl px-3 py-2|rounded-full border border-sky-200|rounded-full bg-red-600/)
  assert.match(groups, /rounded-none border px-3 py-1\.5/)
  assert.match(groups, /<select aria-label="设置个人分组"[\s\S]*rounded-none border border-\[var\(--border\)\]/)
  assert.match(wall, /rounded-none border border-\[var\(--border\)\][\s\S]*shadow-none/)
  assert.doesNotMatch(wall, /rounded-\[(24|28)px\]|rounded-2xl shadow|rounded-full bg-brand/)
})

test('管理记录改为分割线区域，性别选择使用矩形选中态', () => {
  assert.match(recordSettings, /mb-3 min-w-0 border-b border-\[var\(--border\)\] pb-3/)
  assert.doesNotMatch(recordSettings, /mb-3 rounded-xl|rounded-full px-2\.5/)
  assert.match(form, /form\.gender === value \? 'border-\[var\(--primary\)\]/)
  assert.match(form, /\['PRIVATE', '保密'\]/)
  assert.doesNotMatch(form, /不设置/)
})

test('编辑资料容器、控件、地区弹层和底部操作栏使用轻量圆角', () => {
  assert.match(editor, /profile-editor-drawer ml-auto[\s\S]*overflow-hidden md:max-w-2xl/)
  assert.match(editor, /rounded-sm border border-\[var\(--border\)\][\s\S]*关闭/)
  assert.doesNotMatch(editor, /shadow-(lg|xl|2xl)|rounded-(xl|2xl|3xl)|rounded-\[(24|28)px\]/)
  assert.match(form, /profile-settings-form space-y-5 rounded-none border p-6 shadow-none/)
  assert.match(form, /profile-settings-actions[\s\S]*rounded-sm border border-\[var\(--primary\)\]/)
  assert.doesNotMatch(form, /rounded-(xl|2xl|3xl)|rounded-\[(24|28)px\]|shadow-(lg|xl|2xl)/)
  assert.match(locationPicker, /overflow-hidden rounded-none border border-\[var\(--border\)\][\s\S]*shadow-none/)
  assert.match(locationPicker, /min-h-12 w-full items-center justify-between[\s\S]*rounded-sm border/)
})

test('主页徽章小览和资料底栏不恢复大阴影或大圆角', () => {
  assert.match(css, /\.profile-settings-form \.profile-settings-actions \{[^}]*box-shadow:none;/)
  assert.match(css, /\.badge-mini-showcase \{[^}]*border-radius:2px;[^}]*box-shadow:none;/)
  assert.match(css, /\.badge-mini-showcase-cabinet \{[^}]*border-radius:2px;/)
  assert.match(css, /\.badge-mini-showcase-empty \{[^}]*border-radius:2px;/)
  assert.match(css, /\.profile-page-surface \.badge-collection-section :where\(section,article,div,a,button\)\.rounded-2xl/)
  assert.match(badges, /badge-collection-section rounded-none border border-\[var\(--border\)\][\s\S]*shadow-none/)
  assert.match(remark, /max-w-sm rounded-sm border border-\[var\(--border\)\][\s\S]*shadow-none/)
  assert.doesNotMatch(remark, /rounded-(xl|2xl|3xl)|shadow-(lg|xl|2xl)/)
})
