import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * V4.2 sending animation: one shared 1500ms clock, seamless overlapping beats,
 * and a skip button that is clickable from the first frame on a real phone.
 * These are source-level contracts so they run in CI without a browser, while
 * the browser suite verifies the rendered motion.
 */

const read = (path: string) => readFileSync(path, 'utf8')
const tsx = read('components/shun-master/SendAnonymousLetter.tsx')
const css = read('components/shun-master/send-anonymous-letter.module.css')
const client = read('app/shun-master/ShunMasterClient.tsx')

/** Parse `key: { start: N, end: N }` entries out of the exported TIMELINE. */
function parseTimeline(): Record<string, { start: number; end: number }> {
  const out: Record<string, { start: number; end: number }> = {}
  const body = /export const TIMELINE = \{([\s\S]*?)\n\} as const/.exec(tsx)?.[1]
  assert.ok(body, '必须从组件导出 shared TIMELINE')
  for (const m of body.matchAll(/(\w+): \{ start: (\d+), end: (\w+|\d+) \}/g)) {
    const end = m[3] === 'ANIMATION_MS' ? 1500 : Number(m[3])
    out[m[1]] = { start: Number(m[2]), end }
  }
  return out
}

test('a single shared clock bounds the whole animation to 1500ms', () => {
  assert.match(tsx, /export const ANIMATION_MS = 1500/, '单一时钟常量必须是 1500ms')
  assert.match(css, /--clock: 1500ms/, 'CSS 必须使用同一个 1500ms 时钟')
  // Every timeline beat ends at or before the clock — nothing runs long.
  for (const [stage, { start, end }] of Object.entries(parseTimeline())) {
    assert.ok(end <= 1500, `${stage} 结束 ${end}ms 不得超过 1500ms`)
    assert.ok(start < end, `${stage} 时间窗必须为正`)
  }
  const last = parseTimeline().flying.end
  assert.equal(last, 1500, '最后一拍必须在 1500ms 结束')
})

test('the six beats follow the documented windows and overlap with no idle gap', () => {
  const t = parseTimeline()
  const expected = {
    paper: [0, 120], folding: [100, 380], inserting: [300, 700],
    sealing: [620, 900], stamping: [850, 1120], flying: [1080, 1500],
  }
  for (const [stage, [start, end]] of Object.entries(expected)) {
    assert.deepEqual(t[stage], { start, end }, `${stage} 必须符合规定时间窗`)
  }
  // Consecutive beats must overlap (next.start <= prev.end): no static pause.
  assert.ok(t.folding.start <= t.paper.end, '折叠必须在信纸出现结束前开始')
  assert.ok(t.inserting.start <= t.folding.end, '入封必须在折叠结束前开始')
  assert.ok(t.sealing.start <= t.inserting.end, '封口必须在入封结束前开始')
  assert.ok(t.stamping.start <= t.sealing.end, '盖章必须在封口结束前开始')
  assert.ok(t.flying.start <= t.stamping.end, '飞出必须在盖章结束前开始')
})

test('fold finishes before the pocket can cover the paper', () => {
  // Fold is driven by one 3D rotation with a real crease origin.
  assert.match(css, /\.sheetLower \{[\s\S]{0,240}?transform-origin: top center/)
  assert.match(css, /@keyframes creaseFold[\s\S]*?rotateX\(-176deg\)/, '折叠必须是真实 3D 旋转')
  assert.match(css, /perspective: 900px/, '必须提供真实透视')
  assert.doesNotMatch(css, /@keyframes creaseFold[\s\S]*?scaleY\(/, '不得压扁伪装折叠')
  // The pocket cannot start covering until the fold's 380ms boundary.
  const pocket = /@keyframes pocketIn \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.match(pocket, /0%, 25\.333% \{ opacity: 0; \}/, '380ms(25.333%) 前口袋必须完全透明，折叠不得被遮挡')
  assert.match(pocket, /46\.667%, 100% \{ opacity: 1; \}/, '700ms 后口袋必须不透明，真正遮住信纸')
})

test('paper is genuinely occluded by the pocket, never faded out early', () => {
  const zIndexOf = (selector: string) => Number(new RegExp(`${selector} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1])
  assert.ok(zIndexOf('.envBack') < zIndexOf('.sheet'), '信纸必须在信封后层之前')
  assert.ok(zIndexOf('.sheet') < zIndexOf('.pocket'), '信纸必须在口袋之后，才会被真正遮住')
  assert.ok(zIndexOf('.pocket') < zIndexOf('.flap'), '翻盖必须盖住袋口')
  assert.match(css, /\.pocket \{[^}]*clip-path: polygon\(0 0, 50% 42%/, '口袋必须是 V 形开口')
  assert.match(css, /@keyframes paperJourney[\s\S]*?translate3d\(-50%, calc\(100% \+ 24px\), 0\)/,
    '装入阶段必须真的滑入口袋后方')
  const journey = /@keyframes paperJourney \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.doesNotMatch(journey, /0%;?[^}]*opacity: 0[\s\S]{0,120}?20%[\s\S]{0,120}?opacity: 0/,
    '装入过程中不得提前淡出假装装入')
})

test('flap closes before wax is pressed, and the stamp lifts before flying', () => {
  const flap = /@keyframes flapClose \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.match(flap, /60%, 100% \{ opacity: 1; transform: rotateX\(0deg\); \}/, '翻盖必须真正合上')
  assert.match(flap, /0% \{ opacity: 0; transform: rotateX\(-172deg\); \}/, '合上前翻盖必须张开')
  // Wax only becomes visible after the flap closed (60% = 900ms boundary).
  const wax = /@keyframes waxSet \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.match(wax, /0%, 62% \{ opacity: 0; transform: scale\(\.55\); \}/, '信封合上前不得出现火漆')
  assert.match(wax, /74\.667%, 100% \{ opacity: 1; transform: scale\(1\); \}/, '飞出前火漆必须成型')
  const stamp = /@keyframes stampPress \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.match(stamp, /translateY\(0\) scale\(\.94\)/, '印章必须有压印动作')
  assert.match(stamp, /74\.667% \{ opacity: 0; transform: translateY\(-150%\)/, '印章必须在飞出前抬起离场')
  assert.match(css, /\.wax \{[\s\S]*?radial-gradient\(circle at 34% 30%, #a33a4c/, '火漆必须是深酒红渐变')
  assert.match(tsx, /<div className=\{styles\.wax\}[^>]*><span>E<\/span>/, '封蜡中央必须有 E 标识')
})

test('the sealed envelope flies out with transform+opacity and leaves no residue', () => {
  assert.match(css, /\.envelope \{[\s\S]{0,200}?animation: flyOut var\(--clock\)/, '飞出必须使用共享时钟')
  assert.match(css, /@keyframes flyOut \{[\s\S]*?translate3d\(72%, -96%, 0\) rotate\(20deg\) scale\(\.2\)/,
    '飞出必须朝右上方、带旋转并缩小')
  assert.match(css, /@keyframes flyOut \{[\s\S]*?opacity: 0; \}/, '飞出结束必须透明，无残留元素')
  const fly = /@keyframes flyOut \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.doesNotMatch(fly, /\b(top|left|right|bottom|width|height):/, '只能动画 transform/opacity，避免触发布局')
})

test('the skip button is portalled above all layers, fixed top-right, and ≥44×44', () => {
  // Portal to <body> so no transform stacking context or native dialog top layer
  // can trap the button; dialog is explicitly closed before animate mounts.
  assert.match(tsx, /createPortal\(tree, document\.body\)/, '动画层必须 Portal 到 body')
  assert.match(client, /dialog\.current\?\.close\(\)[\s\S]{0,80}setStep\('animate'\)/,
    '挂载动画前必须关闭原生 dialog，避免 top layer 遮挡')
  const skip = /\.skip \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.match(skip, /position: fixed/, '跳过按钮必须脱离信封、固定在遮罩层')
  assert.match(skip, /top: calc\(10px \+ env\(safe-area-inset-top, 0px\)\)/, '必须考虑顶部安全区')
  assert.match(skip, /right: calc\(10px \+ env\(safe-area-inset-right, 0px\)\)/, '必须固定在右上角')
  assert.match(skip, /min-width: 44px/, '点击区域宽度至少 44px')
  assert.match(skip, /min-height: 44px/, '点击区域高度至少 44px')
  assert.match(skip, /background: #1b1a17f2/, '必须有高对比度不透明背景')
  assert.match(skip, /pointer-events: auto/, '按钮必须可点击')
  assert.match(skip, /z-index: 10/, '按钮层级必须高于信纸/信封/火漆')
  const overlay = /\.overlay \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  assert.match(overlay, /z-index: 2147483000/, '遮罩层必须高于页面所有悬浮层')
  // Button is a sibling of .desk, never inside the rotating 3D container.
  assert.match(tsx, /<\/div>\s*<p className=\{styles\.hint\}/, '按钮区域必须在信封容器之外')
  assert.match(tsx, /<button type="button" className=\{styles\.skip\} onClick=\{skip\}>跳过动画<\/button>/)
})

test('skip, natural end and repeated taps all fire the success callback exactly once', () => {
  assert.match(tsx, /const finished = useRef\(false\)/, '必须有幂等闸门')
  assert.equal((tsx.match(/if \(finished\.current\) return/g) ?? []).length, 2,
    'finish 与 skip 都必须先检查幂等闸门')
  assert.match(tsx, /const finish = \(\) => \{[\s\S]{0,160}?finished\.current = true[\s\S]{0,80}?onCompleteRef\.current\(\)/)
  // Hand-off lands a frame before the CSS clock so even the mount→unmount window
  // stays inside the 1500ms budget (the browser starts the CSS clock one frame
  // after the overlay is inserted).
  assert.match(tsx, /export const HANDOFF_MS = ANIMATION_MS - 32/, '交接必须预留渲染余量')
  assert.match(tsx, /window\.setTimeout\(finish, HANDOFF_MS\)/, '只用一个定时器在时钟终点结束')
  assert.match(tsx, /timers\.push\(window\.setTimeout\(\(\) => setStage\(next\), TIMELINE\[next\]\.start\)\)/,
    '阶段切换只用绝对偏移，不累加定时器')
  assert.match(client, /onComplete=\{\(\) => \{[\s\S]{0,160}setStep\('delivered'\)/, '结束只切状态，不重新提交')
  assert.doesNotMatch(tsx, /fetch\(|@\/lib\/shun-master/, '动画不得调用任何接口')
})

test('reduced-motion collapses to a static sealed envelope', () => {
  assert.match(tsx, /prefers-reduced-motion: reduce/, '组件必须检测减少动画偏好')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, '样式必须兼容减少动画偏好')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important/)
})
