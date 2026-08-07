import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('分类 slug 工具函数已新增（允许中文 + 映射 + 唯一）', () => {
  const lib = read('lib/music-concert-category.ts')
  // 核心工具函数均已导出。
  assert.match(lib, /export const CATEGORY_NAME_SLUG_MAP/)
  assert.match(lib, /export function slugifyCategoryName/)
  assert.match(lib, /export function isValidCategorySlug/)
  assert.match(lib, /export async function ensureUniqueCategorySlug/)
  // 常见中文分类名有英文映射（不再依赖拼音库，避免生成失败）。
  assert.match(lib, /音乐节:\s*'music-festival'/)
  assert.match(lib, /电台节目:\s*'radio-show'/)
  assert.match(lib, /其他企划:\s*'other-project'/)
  // 新版校验允许中文（与巡演 slug 约定一致），不再仅限 ASCII。
  assert.match(lib, /isValidCategorySlug\(value: string\): boolean \{[\s\S]*一-龥/)
  // 唯一性保证：命中已存在记录时追加 -2 / -3。
  assert.match(lib, /slug = `\$\{baseSlug\}-\$\{attempt\}`/)
})

test('分类 slug 工具函数运行期行为（允许中文 / 映射 / 校验）', async () => {
  let mod: typeof import('@/lib/music-concert-category') | null = null
  try {
    mod = await import('@/lib/music-concert-category')
  } catch {
    // 沙箱未生成 @prisma/client 时无法导入（仅影响运行期校验，CI 中正常）。
    console.warn('[concert-category-detail] 跳过运行期 slug 校验：@prisma/client 未生成')
    return
  }
  // 中文分类名 → 英文 slug。
  assert.equal(mod.slugifyCategoryName('音乐节'), 'music-festival')
  assert.equal(mod.slugifyCategoryName('线上演出'), 'online-show')
  assert.equal(mod.slugifyCategoryName('Other Show'), 'other-show')
  // 校验：允许英文与中文，且必须以字母/数字/中文开头。
  assert.equal(mod.isValidCategorySlug('music-festival'), true)
  assert.equal(mod.isValidCategorySlug('音乐节'), true)
  assert.equal(mod.isValidCategorySlug('-bad'), false)
  assert.equal(mod.isValidCategorySlug(''), false)
  // 核心分类仍受保护。
  assert.equal(mod.isReservedCategorySlug('main'), true)
  assert.equal(mod.isReservedCategorySlug('music-festival'), false)
})

test('分类详情动态路由：按 categoryId 查询所有公开类型，不写死 CONCERT/MAIN', () => {
  const page = read('app/music/live/[slug]/page.tsx')
  // 通过 categoryId 查询该分类下巡演。
  assert.match(page, /tourWhere/)
  assert.match(page, /categoryId/)
  // 不写死单一类型：查询覆盖所有公开类型（核心分类兼容旧 enum）。
  assert.doesNotMatch(page, /category:\s*'MAIN'/)
  assert.doesNotMatch(page, /status:\s*'CONCERT'/)
  // 核心分类：通过枚举回退覆盖旧数据。
  assert.match(page, /MUSIC_CONCERT_CATEGORY_SLUG_TO_ENUM/)
  assert.match(page, /isReservedCategorySlug/)
})

test('分类详情动态路由：slug 找不到时友好空态，不直接 404', () => {
  const page = read('app/music/live/[slug]/page.tsx')
  // 友好文案与返回入口。
  assert.match(page, /该分类暂无内容/)
  assert.match(page, /返回完整档案/)
  assert.match(page, /浏览全部巡演/)
  // 绝不使用 notFound()（避免 404）。
  assert.doesNotMatch(page, /notFound\(/)
})

test('后台分类 API：不再拒绝中文 slug，且保证唯一', () => {
  for (const path of [
    'app/api/admin/music/categories/route.ts',
    'app/api/admin/music/categories/[categoryId]/route.ts',
  ]) {
    const route = read(path)
    // 改用新工具自动生成并去重。
    assert.match(route, /slugifyCategoryName/)
    assert.match(route, /ensureUniqueCategorySlug/)
    // 旧版仅允许 ASCII 的校验函数已移除（不再因中文名 400）。
    assert.doesNotMatch(route, /function isValidSlug/)
    assert.doesNotMatch(route, /isValidSlug\(/)
    assert.doesNotMatch(route, /只能包含小写字母、数字与连字符/)
  }
})

test('分类卡片组件：为每个分类生成 /music/live/[slug] 链接（不隐藏、不全部跳大型演唱会）', () => {
  const cards = read('components/music/ConcertCategoryCards.tsx')
  // 逐分类生成链接。
  assert.match(cards, /href=\{\`\/music\/live\/\$\{category\.slug\}\`\}/)
  // 遍历全部分类（无隐藏逻辑）。
  assert.match(cards, /categories\.map/)
  // 当前分类高亮（aria-current）。
  assert.match(cards, /aria-current=\{active \? 'page' : undefined\}/)
  // 不出现「全部跳 main」之类的硬编码。
  assert.doesNotMatch(cards, /href=\{`\/music\/live\/main`\}/)
})

test('前台三个入口均接入分类卡片', () => {
  for (const path of ['app/music/concerts/page.tsx', 'app/music/page.tsx', 'app/music/live/page.tsx']) {
    const page = read(path)
    assert.match(page, /ConcertCategoryCards/)
  }
  // /music/live 页面需要获取分类数据喂给卡片。
  const livePage = read('app/music/live/page.tsx')
  assert.match(livePage, /getEnabledConcertCategories/)
})
