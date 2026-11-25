import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ECENTER_FEATURES, mergeEcenterFeatureSettings, validateEcenterFeatureUpdates } from '../lib/ecenter-features'

/**
 * V4.1 UX fixes: readable letters in midnight mode, one investigation entry
 * label, a manageable Shun Master navigation item, and a sending animation that
 * really folds, inserts, seals and stamps.
 */

const read = (path: string) => readFileSync(path, 'utf8')
const letterCss = read('components/shun-master/anonymous-letter.module.css')
const sendCss = read('components/shun-master/send-anonymous-letter.module.css')
const sendTsx = read('components/shun-master/SendAnonymousLetter.tsx')
const shunCss = read('app/shun-master/shun.module.css')
const client = read('app/shun-master/ShunMasterClient.tsx')

// ---------------------------------------------------------------- dark mode

test('the letter keeps its own paper palette in the midnight theme', () => {
  // The global theme recolours every [role='dialog']; the overlay opts out with
  // an attribute selector that outranks it regardless of stylesheet order.
  assert.match(letterCss, /\.overlay\[role='dialog'\]\[aria-modal='true'\]\s*\{[^}]*color: #1b1a17/,
    '信件弹层必须显式声明墨色，不能被全局黑夜主题改写成浅色')
  for (const [name, pattern] of [
    ['信纸根容器', /\.paper \{[^}]*color: #1b1a17/],
    ['标题', /\.paper h2 \{[^}]*color: #1b1a17/],
    ['留言正文', /\.body \{[^}]*color: #1b1a17/],
    ['落款', /\.signature \{[^}]*color: #5b5247/],
    ['调查结果标题', /\.verdictTitle \{[^}]*color: #1b1a17/],
    ['调查结果金额', /\.verdictAmount \{[^}]*color: #3b352d/],
    ['真实顺取者昵称', /\.verdictPerson \{[^}]*color: #1b1a17/],
    ['操作按钮', /\.actions button \{[^}]*color: #1b1a17/],
  ] as const) {
    assert.match(letterCss, pattern, `${name}必须固定为深色，不能继承暗色主题`)
  }
  assert.match(letterCss, /\.actions \.primary \{[^}]*color: #fbf6ea/, '主按钮文字必须与酒红底保持对比')
})

test('the result modal and the sending paper stay cream in the midnight theme', () => {
  // `.modalBody` is a plain div, so the global `:where(dialog, [role=dialog])`
  // reset can never repaint it.
  assert.match(shunCss, /\.modalBody\{background:#f1e7d5;color:#171717\}/, '结果弹窗纸面必须自带配色')
  assert.match(shunCss, /\.modalBody h2,\.modalBody strong,\.modalBody p\{color:#171717\}/, '弹窗内所有文字必须显式深色')
  assert.match(shunCss, /\.modalBody \.letterSent\{color:#7b2233\}/)
  assert.match(shunCss, /\.modal textarea\{[^}]*color:#171717/, '留言输入框文字必须可见')
  assert.match(sendCss, /\.overlay\[role='dialog'\]\[aria-modal='true'\]\s*\{[^}]*color: #1b1a17/)
  assert.match(sendCss, /\.sheetUpper \{[\s\S]{0,200}?color: #1b1a17/, '寄信信纸必须固定墨色')
  assert.match(sendCss, /\.ink \{[^}]*color: #1b1a17/)
})

// ------------------------------------------------------------ entry label

test('every investigation entry uses the same label', () => {
  assert.doesNotMatch(client, />抓捕追回</, '记录入口不得再出现旧文案')
  assert.match(client, /openCapture\(row\.id\)\)\}>前往调查</, '谁顺了我的记录入口必须叫「前往调查」')
  assert.match(client, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); closeResult\(\) \}\}/)
  // Already investigated: the row shows the real outcome and offers no second try.
  assert.match(client, /\{row\.result && <p>\{row\.result === 'SUCCESS' \? `已追回 \$\{row\.recovered\} 挂号费` : '抓捕失败 · 未追回'\}<\/p>\}/)
  assert.match(client, /\{side === 'in' && !row\.result && \(row\.canCapture \?/, '已结算记录不再提供重复抓捕')
})

// ------------------------------------------------------------ navigation

test('顺大师 is a manageable navigation entry and can be reordered and saved', () => {
  const shun = ECENTER_FEATURES.find((feature) => feature.featureKey === 'SHUN_MASTER')
  assert.ok(shun, '顺大师必须仍在注册表中')
  assert.equal(shun.isManageable, true, '必须允许上移/下移与排序保存')
  assert.equal(shun.editable, true)
  assert.equal(shun.href, '/shun-master', '不得改动原有 href')
  // Fixed core entries stay out of the sortable set.
  for (const fixed of ['HOME', 'PROFILE']) {
    assert.equal(ECENTER_FEATURES.find((feature) => feature.featureKey === fixed)?.isManageable, false,
      `${fixed} 必须保持固定，不参与排序`)
  }
  const accepted = validateEcenterFeatureUpdates([
    { featureKey: 'SHUN_MASTER', sortOrder: 7, isEnabled: true },
    { featureKey: 'MUSIC', sortOrder: 44, isEnabled: true },
  ])
  assert.ok('updates' in accepted, '服务端必须接受顺大师的排序更新')
})

test('a saved sort order actually reorders the merged navigation list', () => {
  const before = mergeEcenterFeatureSettings([]).map((feature) => feature.featureKey)
  const originalIndex = before.indexOf('SHUN_MASTER')
  const neighbourKey = before[originalIndex - 1]
  assert.ok(neighbourKey, '顺大师前方必须存在可交换的邻居')
  const neighbour = mergeEcenterFeatureSettings([]).find((feature) => feature.featureKey === neighbourKey)!
  // Swap the two sort orders, exactly what the admin save writes.
  const after = mergeEcenterFeatureSettings([
    { featureKey: 'SHUN_MASTER', sortOrder: neighbour.sortOrder, isEnabled: true },
    { featureKey: neighbourKey, sortOrder: 44, isEnabled: true },
  ]).map((feature) => feature.featureKey)
  assert.ok(after.indexOf('SHUN_MASTER') < after.indexOf(neighbourKey),
    '保存排序后前台合并结果必须真的前移')
  assert.notDeepEqual(after, before)
})

// ------------------------------------------------------------- animation
// V4.2 moved the motion onto one shared 1500ms CSS keyframe clock. The detailed
// timeline/seamlessness/skip contracts live in shun-master-v42-animation.test.ts;
// these keep the original V4.1 invariants expressed against the new architecture.

test('the sending animation folds the paper in 3D instead of squashing it', () => {
  assert.match(sendCss, /\.sheetLower \{[\s\S]{0,240}?transform-origin: top center/, '必须以折痕为轴翻转')
  assert.match(sendCss, /@keyframes creaseFold[\s\S]*?rotateX\(-176deg\)/,
    '折叠必须是真实的 3D 旋转，而不是 scaleY 压扁')
  assert.match(sendCss, /perspective: 900px/, '必须提供真实透视')
  assert.doesNotMatch(sendCss, /@keyframes creaseFold[\s\S]*?scaleY\(/, '不得用压扁伪装折叠')
})

test('the paper really slides behind the envelope pocket', () => {
  const zIndexOf = (selector: string) => Number(new RegExp(`${selector} \\{[^}]*z-index: (\\d+)`).exec(sendCss)?.[1])
  assert.ok(zIndexOf('.envBack') < zIndexOf('.sheet'), '信纸必须在信封后层之前')
  assert.ok(zIndexOf('.sheet') < zIndexOf('.pocket'), '信纸必须在信封口袋之后，才会被真正遮住')
  assert.ok(zIndexOf('.pocket') < zIndexOf('.flap'), '翻盖必须盖住袋口')
  assert.match(sendCss, /\.pocket \{[^}]*clip-path: polygon\(0 0, 50% 42%/, '口袋必须是 V 形开口')
  assert.match(sendCss, /@keyframes paperJourney[\s\S]*?translate3d\(-50%, calc\(100% \+ 24px\), 0\)/,
    '装入阶段必须真的向下滑入口袋后方')
  const journey = /@keyframes paperJourney \{([\s\S]*?)\n\}/.exec(sendCss)?.[1] ?? ''
  // Insert window is 20%→46.667%: opacity must be 1 at both ends (slides, not fades).
  assert.match(journey, /20% \{ opacity: 1;/, '装入起点必须不透明')
  assert.match(journey, /46\.667% \{ opacity: 1;/, '装入终点必须不透明，不得淡出假装装入')
})

test('the flap closes, a stamp presses and leaves wax behind', () => {
  assert.match(sendCss, /@keyframes flapClose[\s\S]*?rotateX\(0deg\)/, '翻盖必须真的转下来')
  assert.match(sendCss, /@keyframes stampPress[\s\S]*?translateY\(0\) scale\(\.94\)[\s\S]*?opacity: 0;/,
    '印章必须压下后抬起离场')
  assert.match(sendCss, /@keyframes waxSet[\s\S]*?scale\(1\.08\)/, '印章落下后必须留下火漆')
  assert.match(sendCss, /\.wax \{[\s\S]*?radial-gradient\(circle at 34% 30%, #a33a4c/, '火漆必须是深酒红渐变')
  assert.match(sendTsx, /<div className=\{styles\.wax\}[^>]*><span>E<\/span>/, '封蜡中央必须有 E 标识')
})

test('the sealed envelope flies away within 1500ms and the timeline stays skippable', () => {
  assert.match(sendCss, /\.envelope \{[\s\S]{0,200}?animation: flyOut var\(--clock\)/)
  assert.match(sendCss, /@keyframes flyOut \{[\s\S]*?translate3d\(72%, -96%, 0\) rotate\(20deg\) scale\(\.2\)/,
    '飞出必须朝右上方、带旋转并缩小')
  assert.match(sendCss, /@keyframes waxSet[\s\S]*?74\.667%, 100% \{ opacity: 1; transform: scale\(1\); \}/,
    '飞出的必须是带火漆的信封')
  assert.match(sendTsx, /export const ANIMATION_MS = 1500/, '总时长不得超过 1500ms')
  assert.match(sendTsx, /跳过动画/)
  assert.match(sendCss, /@media \(prefers-reduced-motion: reduce\)/)
  assert.doesNotMatch(sendTsx, /fetch\(|@\/lib\/shun-master/, '动画组件不得调用任何接口')
})
