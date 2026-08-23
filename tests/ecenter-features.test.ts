import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ECENTER_FEATURES,
  filterEcenterFeaturesForUser,
  mergeEcenterFeatureSettings,
  mergeFeatureRegistryWithSettings,
  validateEcenterFeatureUpdates,
} from '../lib/ecenter-features'

const read = (path: string) => readFileSync(path, 'utf8')

test('没有数据库覆盖时使用 Registry 默认顺序，勋章展览馆不强制排第一', () => {
  const features = mergeEcenterFeatureSettings([])
  assert.equal(features[0]?.featureKey, 'CREATE_POST')
  assert.equal(features.findIndex((feature) => feature.featureKey === 'BADGE_MUSEUM'), 7)
  assert.equal(features.length, ECENTER_FEATURES.length)
})

test('数据库只覆盖顺序和启用状态，缺失新入口仍自动出现', () => {
  const features = mergeEcenterFeatureSettings([{ featureKey: 'BADGE_MUSEUM', sortOrder: 0, isEnabled: false }])
  assert.equal(features.find((feature) => feature.featureKey === 'BADGE_MUSEUM')?.isEnabled, false)
  assert.equal(features.some((feature) => feature.featureKey === 'CREATE_POST'), true)
  assert.equal(features.length, ECENTER_FEATURES.length)
})

test('未知数据库 key 被忽略，未来 Registry 新入口无需 seed 也会自动出现', () => {
  const merged = mergeEcenterFeatureSettings([
    { featureKey: 'UNKNOWN_FEATURE', sortOrder: 0, isEnabled: false },
  ])
  assert.equal(merged.length, ECENTER_FEATURES.length)
  assert.equal(merged.some((feature) => String(feature.featureKey) === 'UNKNOWN_FEATURE'), false)

  const futureFeature = {
    ...ECENTER_FEATURES[0],
    featureKey: 'FUTURE_TEST_FEATURE',
    label: '未来测试功能',
    href: '/future-test-feature',
    defaultSortOrder: 15,
    activePrefixes: ['/future-test-feature'],
  }
  const futureMerged = mergeFeatureRegistryWithSettings([...ECENTER_FEATURES, futureFeature], [])
  assert.equal(futureMerged.at(-1)?.featureKey, 'FUTURE_TEST_FEATURE')
  assert.equal(futureMerged.at(-1)?.isEnabled, true)
})

test('权限过滤后顺序稳定，ADMIN 只对后台权限用户可见', () => {
  const features = mergeEcenterFeatureSettings([
    { featureKey: 'ADMIN', sortOrder: 0, isEnabled: true },
    { featureKey: 'BADGE_MUSEUM', sortOrder: 2, isEnabled: true },
  ])
  const regularUserFeatures = filterEcenterFeaturesForUser(features, false)
  assert.deepEqual(regularUserFeatures.slice(0, 2).map((feature) => feature.featureKey), ['CREATE_POST', 'CHECKIN'])
  assert.equal(regularUserFeatures.some((feature) => feature.featureKey === 'ADMIN'), false)
  assert.equal(regularUserFeatures.findIndex((feature) => feature.featureKey === 'BADGE_MUSEUM'), 2)
  assert.equal(filterEcenterFeaturesForUser(features, true)[0]?.featureKey, 'ADMIN')
})

test('ADMIN 配置到第三位时只参与管理员列表，普通用户列表自然补位', () => {
  const overrides = ECENTER_FEATURES.map((feature, index) => ({
    featureKey: feature.featureKey,
    sortOrder: feature.featureKey === 'ADMIN' ? 3 : (index < 2 ? index + 1 : index + 2),
    isEnabled: true,
  }))
  const features = mergeEcenterFeatureSettings(overrides)
  const adminFeatures = filterEcenterFeaturesForUser(features, true)
  const regularFeatures = filterEcenterFeaturesForUser(features, false)
  assert.equal(adminFeatures[2]?.featureKey, 'ADMIN')
  assert.equal(regularFeatures.some((feature) => feature.featureKey === 'ADMIN'), false)
  assert.deepEqual(regularFeatures.slice(0, 3).map((feature) => feature.featureKey), ['CREATE_POST', 'CHECKIN', 'ENTERTAINMENT'])
})

test('重复 sortOrder 使用默认顺序和 featureKey 作为稳定次级排序', () => {
  const features = mergeEcenterFeatureSettings([
    { featureKey: 'BADGE_MUSEUM', sortOrder: 10, isEnabled: true },
    { featureKey: 'CREATE_POST', sortOrder: 10, isEnabled: true },
  ])
  assert.deepEqual(features.filter((feature) => ['CREATE_POST', 'BADGE_MUSEUM'].includes(feature.featureKey)).map((feature) => feature.featureKey), ['CREATE_POST', 'BADGE_MUSEUM'])
})

test('后台更新严格限制 featureKey、sortOrder 和启用状态', () => {
  assert.deepEqual(validateEcenterFeatureUpdates([
    { featureKey: 'BADGE_MUSEUM', sortOrder: 8, isEnabled: true },
  ]), { updates: [{ featureKey: 'BADGE_MUSEUM', sortOrder: 8, isEnabled: true }] })
  const unknown = validateEcenterFeatureUpdates([{ featureKey: 'FAKE_FEATURE', sortOrder: 1, isEnabled: true }])
  const duplicate = validateEcenterFeatureUpdates([
    { featureKey: 'BADGE_MUSEUM', sortOrder: 1, isEnabled: true },
    { featureKey: 'BADGE_MUSEUM', sortOrder: 2, isEnabled: false },
  ])
  const fractional = validateEcenterFeatureUpdates([{ featureKey: 'BADGE_MUSEUM', sortOrder: 1.5, isEnabled: true }])
  const negative = validateEcenterFeatureUpdates([{ featureKey: 'BADGE_MUSEUM', sortOrder: -1, isEnabled: true }])
  const stringOrder = validateEcenterFeatureUpdates([{ featureKey: 'BADGE_MUSEUM', sortOrder: '8', isEnabled: true }])
  const tooLarge = validateEcenterFeatureUpdates([{ featureKey: 'BADGE_MUSEUM', sortOrder: 100001, isEnabled: true }])
  assert.equal('error' in unknown, true)
  assert.equal('error' in duplicate, true)
  assert.equal('error' in fractional, true)
  assert.equal('error' in negative, true)
  assert.equal('error' in stringOrder, true)
  assert.equal('error' in tooLarge, true)
  if ('error' in unknown) assert.match(unknown.error, /未知、重复或不可管理/)
  if ('error' in fractional) assert.match(fractional.error, /整数/)
})

test('主弹窗、快捷入口和移动端不再维护重复的中心入口数组', () => {
  const mobile = read('components/layout/MobileNavigation.tsx')
  const sidebar = read('components/layout/Sidebar.tsx')
  const navigation = read('components/layout/navigation.ts')
  assert.match(mobile, /ecenterFeatures/)
  assert.match(sidebar, /ecenterFeatures\.filter/)
  assert.doesNotMatch(navigation, /quickNavigation/)
})

test('通知角标仍由运行时 unreadCount 驱动，而不是排序配置', () => {
  const mobile = read('components/layout/MobileNavigation.tsx')
  const features = mergeEcenterFeatureSettings([{ featureKey: 'NOTIFICATIONS', sortOrder: 1, isEnabled: true }])
  const notification = features.find((feature) => feature.featureKey === 'NOTIFICATIONS')
  assert.equal(notification?.showsUnread, true)
  assert.match(mobile, /item\.showsUnread && unreadCount > 0/)
  assert.match(mobile, /<b>\{unreadCount\}<\/b>/)
  assert.doesNotMatch(mobile, /index\s*===\s*\d+[\s\S]{0,80}unreadCount/)
})

test('后台保存使用事务与管理员权限，停用不改变真实路由', () => {
  const route = read('app/api/admin/ecenter/features/route.ts')
  const page = read('app/admin/ecenter-features/page.tsx')
  assert.match(route, /requireAdmin\('nav_manage'\)/)
  assert.match(page, /requireAdminPage\('\/admin\/ecenter-features', 'nav_manage'\)/)
  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /ecenterFeatureSetting\.upsert/)
  assert.match(route, /featureKey: \{ in: keys \}/)
  assert.match(read('app/badges/page.tsx'), /export default/)
  assert.match(read('app/posts/new/page.tsx'), /export default/)
})

test('恢复默认只清除 E院中心 override，文案准确说明会恢复完整默认配置', () => {
  const route = read('app/api/admin/ecenter/features/route.ts')
  const manager = read('app/admin/ecenter-features/EcenterFeatureSettingsManager.tsx')
  assert.match(route, /ecenterFeatureSetting\.deleteMany/)
  assert.doesNotMatch(route, /siteSetting\.deleteMany|deleteMany\(\{\s*\}\)/)
  assert.match(route, /已恢复默认配置/)
  assert.match(manager, /恢复默认配置/)
  assert.match(manager, /router\.refresh\(\)/)
  assert.doesNotMatch(route, /revalidatePath\('\/', 'layout'\)/)
})

test('后台上下移动边界禁用，停用项目仍保留在管理列表', () => {
  const manager = read('app/admin/ecenter-features/EcenterFeatureSettingsManager.tsx')
  assert.match(manager, /index === 0/)
  assert.match(manager, /index === features\.length - 1/)
  assert.match(manager, /features\.map\(\(feature, index\)/)
  assert.match(manager, /feature\.isEnabled \? '开启' : '停用'/)
})

test('迁移只新增配置表且不依赖 seed 或修改现有业务数据', () => {
  const migration = read('prisma/migrations/20260823160000_add_ecenter_feature_settings/migration.sql')
  assert.match(migration, /CREATE TABLE `EcenterFeatureSetting`/)
  assert.match(migration, /UNIQUE INDEX `EcenterFeatureSetting_featureKey_key`/)
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i)
})
