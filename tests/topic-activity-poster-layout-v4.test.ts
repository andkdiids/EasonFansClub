import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { prisma } from '@/lib/prisma'
import { getTopicV2PosterSnapshot, submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { fitPosterText, fitPosterTextInHeight, posterTextLines, RESULT_USER_GAP, TOPIC_POSTER_ACTIVITY_INFO, TOPIC_POSTER_AVATAR, TOPIC_POSTER_BRAND, TOPIC_POSTER_IDENTITY, TOPIC_POSTER_QR, TOPIC_POSTER_QR_BRAND, TOPIC_POSTER_RESULT, TOPIC_POSTER_SIZE, TOP_VISUAL_SAFE_ZONE, USER_ZONE_START, topicPosterLayout, topicPosterQr, topicPosterTimeRange } from '@/lib/topic-activity-v2-poster-layout'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { fixture, instant } from './fixtures/topic-v2-transaction'

test('V4 has four paper groups, real test title priority, no second image slot or sample copy', () => {
  const svg = topicPosterLayout({ activityTitle: '活动名字', testTitle: '真实测试名称', title: '真实结果', description: '真实说明', poster: { showNickname: true } })
  for (const group of ['activity', 'result', 'identity', 'brand']) assert.match(svg, new RegExp(`data-poster-group="${group}"`))
  assert.match(svg, /真实测试名称/); assert.doesNotMatch(svg, /活动名字|KEEP YOUR|CHIN UP|结果图片区域|<image|<filter/)
  assert.match(svg, /私家E院 · ECFC/)
  assert.match(topicPosterLayout({ activityTitle: '回退活动名' }), /回退活动名/)
})

test('result title is centered in its pink strip and a single yellow panel covers every visible description line', () => {
  const svg = topicPosterLayout({
    title: '长标题结果'.repeat(18),
    description: '多行说明文字需要完整落在黄色高亮背景之内。'.repeat(30),
  })
  const result = svg.slice(svg.indexOf('data-poster-group="result"'), svg.indexOf('data-poster-group="brand"'))
  const titleLines = [...result.matchAll(/<text x="536" y="\d+" font-size="\d+" font-weight="900" text-anchor="middle">([^<]*)<\/text>/gu)]
  assert.ok(titleLines.length > 1, 'long title wraps to multiple lines')
  assert.match(result, /<polygon data-poster-panel="result-title"[^>]*fill="#f59ac8"/u)

  const descriptionLines = [...result.matchAll(/<text x="118" y="(\d+)" font-size="(\d+)" font-weight="650">([^<]*)<\/text>/gu)]
  assert.ok(descriptionLines.length > 1, 'long description wraps to multiple visible lines')
  const highlight = result.match(/<polygon data-poster-panel="description-highlight" points="([^"]+)"/u)
  assert.ok(highlight, 'description has one continuous yellow highlight panel')
  const ys = [...highlight[1].matchAll(/[\d.]+,([\d.]+)/gu)].map((match) => Number(match[1]))
  const firstBaseline = Number(descriptionLines[0][1])
  const lastBaseline = Number(descriptionLines.at(-1)![1])
  assert.ok(Math.min(...ys) <= firstBaseline - 29)
  assert.ok(Math.max(...ys) >= lastBaseline + 10, 'highlight continues behind the final wrapped line')
})

test('nickname is larger and vertically centered; identity card and underline use the available width with or without QR', () => {
  for (const showQrCode of [false, true]) {
    const svg = topicPosterLayout({ nickname: 'Andkdiids', poster: { showNickname: true, showQrCode } })
    const identity = svg.slice(svg.indexOf('data-poster-group="identity"'), svg.indexOf('data-poster-group="brand"'))
    const nickname = identity.match(/<text x="292" y="(\d+)" font-size="(\d+)" font-weight="800">Andkdiids<\/text>/u)
    assert.ok(nickname)
    assert.ok(Number(nickname[2]) >= TOPIC_POSTER_IDENTITY.nicknameSize, 'short display name uses the larger poster font')
    const cardWidth = showQrCode ? TOPIC_POSTER_IDENTITY.qrWidth : TOPIC_POSTER_IDENTITY.noQrWidth
    const cardRight = TOPIC_POSTER_IDENTITY.left + cardWidth
    const textRight = cardRight - TOPIC_POSTER_IDENTITY.textRightPadding
    const card = identity.match(/<polygon data-poster-panel="identity" points="([^"]+)"/u)
    assert.ok(card, 'identity card renders alongside the avatar')
    const cardXs = [...card[1].matchAll(/([\d.]+),[\d.]+/gu)].map((match) => Number(match[1]))
    assert.equal(Math.max(...cardXs), cardRight, 'identity card uses the expected QR-aware width')
    assert.match(identity, new RegExp(`M${TOPIC_POSTER_IDENTITY.textLeft} 1240 Q\\d+ 1228 ${textRight} 1238`))
    const baseline = Number(nickname[1])
    assert.ok(baseline >= TOPIC_POSTER_IDENTITY.top + 68 && baseline <= TOPIC_POSTER_IDENTITY.top + 98,
      'single-line nickname baseline is vertically centered in the identity card')
  }
})

test('dates use Beijing minute precision, independently of host time zone, with safe old-result fallback', () => {
  assert.equal(topicPosterTimeRange('2026-10-15T18:40:00Z', '2026-10-16T18:40:00Z'), '2026.10.16 02:40 - 2026.10.17 02:40')
  assert.equal(topicPosterTimeRange(null, 'bad-date'), '活动时间以活动页面为准')
  assert.equal(topicPosterTimeRange('2026-10-15T18:40:00Z', null), '2026.10.16 02:40 起')
})

test('V5 layout uses the shared 3:4 dimensions and leaves the background hero zone clear', () => {
  assert.deepEqual(TOPIC_POSTER_SIZE, { width: 1080, height: 1440 })
  const svg = topicPosterLayout({
    testTitle: '测试名称', title: '结果标题', description: '结果说明',
    poster: { showNickname: true, showQrCode: true },
  })
  assert.match(svg, /width="1080" height="1440" viewBox="0 0 1080 1440"/)
  assert.ok(TOPIC_POSTER_ACTIVITY_INFO.top > TOP_VISUAL_SAFE_ZONE)
  assert.ok(TOPIC_POSTER_RESULT.maxBottom < TOPIC_POSTER_AVATAR.top)
  assert.ok(TOPIC_POSTER_RESULT.maxBottom < TOPIC_POSTER_QR.top)
  assert.doesNotMatch(svg.slice(0, svg.indexOf('data-poster-group="activity"')), /<rect|fill="#102c48"/)
})

test('long Chinese, English and mixed content wraps, shrinks, then truncates on Unicode boundaries', () => {
  for (const value of ['中文'.repeat(200), 'W'.repeat(500), '😀'.repeat(200), '短\n'.repeat(200)]) {
    const title = fitPosterText(value, 820, 60, 38, 2, 1.1)
    const description = fitPosterTextInHeight(value, 800, 30, 22, 168, 1.2, 6)
    assert.ok(title.lines.length <= 2)
    assert.ok(description.lines.length <= 6)
    for (const line of title.lines) assert.ok([...line].reduce((sum, character) => sum + (/^[\x20-\x7e]$/u.test(character) ? (/[MW@%]/u.test(character) ? 1 : .7) : 1.08) * title.fontSize, 0) <= 820)
    for (const line of description.lines) assert.ok([...line].reduce((sum, character) => sum + (/^[\x20-\x7e]$/u.test(character) ? (/[MW@%]/u.test(character) ? 1 : .7) : 1.08) * description.fontSize, 0) <= 800)
    const svg = topicPosterLayout({ title: value, description: value, nickname: value, poster: { showNickname: true, showQrCode: true } })
    const positions = [...svg.matchAll(/<text x="118" y="(\d+)"/gu)].map((match) => Number(match[1]))
    assert.ok(positions.every((y) => y > TOPIC_POSTER_RESULT.top && y < TOPIC_POSTER_RESULT.maxBottom))
    assert.ok(svg.length < 10000)
  }
  const svg = topicPosterLayout({ title: '<script> & "unsafe"', description: '<image href="https://invalid"/>' })
  assert.doesNotMatch(svg, /<script|<image/); assert.match(svg, /&lt;script&gt;/)
  const unicode = posterTextLines('😀'.repeat(200), 120, 40, 1)[0]
  assert.ok(unicode.endsWith('…'))
  assert.doesNotMatch(unicode, /[\uD800-\uDBFF]$/u, 'ellipsis never leaves an unpaired high surrogate')
  const graphemeSource = '👨‍👩‍👧‍👦🇨🇳'.repeat(80)
  const graphemeLine = posterTextLines(graphemeSource, 220, 40, 1)[0]
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const graphemes = Array.from(segmenter.segment(graphemeSource), (part) => part.segment)
  const prefixes = new Set(['', ...graphemes.map((_, index) => graphemes.slice(0, index + 1).join(''))])
  assert.ok(prefixes.has(graphemeLine.slice(0, -1)), 'ellipsis does not split a ZWJ family or flag pair')
})

test('empty description keeps an optional score below the title and inside the result card', () => {
  const svg = topicPosterLayout({ title: '得分标题', description: '', score: 10, maxScore: 20 })
  const scoreBaseline = Number(svg.match(/<text x="118" y="(\d+)"[^>]*>得分 10 \/ 20<\/text>/u)?.[1])
  assert.ok(Number.isFinite(scoreBaseline))
  assert.ok(scoreBaseline > TOPIC_POSTER_RESULT.titleBaseline + TOPIC_POSTER_RESULT.titleLineHeight)
  assert.ok(scoreBaseline < TOPIC_POSTER_RESULT.maxBottom)
})

test('all four privacy layouts keep the result card above optional identity and QR footer zones', () => {
  for (const showNickname of [false, true]) for (const showQrCode of [false, true]) {
    const config = { showNickname, showQrCode }
    const svg = topicPosterLayout({ title: '长说明结果', description: '说明'.repeat(120), nickname: '示例昵称', poster: config })
    const qr = topicPosterQr(config)
    assert.match(svg, /width="1080" height="1440"/)
    assert.equal(svg.includes('data-poster-group="identity"'), showNickname)
    assert.equal(showQrCode ? qr.size : null, showQrCode ? TOPIC_POSTER_QR.size : null)
    assert.equal(TOPIC_POSTER_RESULT.maxBottom, USER_ZONE_START - RESULT_USER_GAP)
    assert.ok(TOPIC_POSTER_RESULT.maxBottom < (showQrCode ? qr.top : TOPIC_POSTER_BRAND.top))
    if (showQrCode && !showNickname) assert.equal(qr.left, Math.round((TOPIC_POSTER_SIZE.width - qr.size) / 2))
    if (showQrCode && showNickname) assert.ok(TOPIC_POSTER_AVATAR.left + TOPIC_POSTER_AVATAR.size < qr.left)
  }
})

test('test submission schema stays unchanged; poster enrichment never changes stored attempt snapshots', async () => {
  const f = fixture()
  Reflect.set(f.tx.user, 'findFirst', async () => ({ nickname: '本人', avatarUrl: '/uploads/user.png', Profile: { avatarUrl: '/uploads/profile.png' } }))
  await f.run(async () => {
    const input = { activityId: f.activity.id, userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'poster-v4-one', now: instant }
    const first = await submitTopicV2Test(input)
    const snapshot = first.attempt.resultSnapshot as Record<string, unknown>
    assert.equal(Object.hasOwn(snapshot, 'activityStartsAt'), false)
    assert.equal(Object.hasOwn(snapshot, 'activityEndsAt'), false)
    assert.equal(Object.hasOwn(snapshot, 'avatarUrl'), false)
    f.activity.startsAt = new Date('2030-01-01T00:00:00Z')
    assert.deepEqual((await submitTopicV2Test(input)).attempt.resultSnapshot, snapshot)
  })
})

test('poster-only historical enrichment is owner-scoped, read-only and preserves frozen result fields/nulls', async () => {
  const original = prisma.topicActivityTestAttempt.findFirst
  const stored = { title: '旧结果', testTitle: '旧测试', imageUrl: '/uploads/old.png', poster: { showNickname: false }, activityStartsAt: null }
  Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async (query: { where: { userId: string; activityId: string; id: string } }) => {
    assert.deepEqual(query.where, { id: 'attempt-one', activityId: 'activity-one', userId: query.where.userId })
    return query.where.userId === 'owner' ? { resultSnapshot: structuredClone(stored), Activity: { startsAt: instant, endsAt: instant }, User: { avatarUrl: '/uploads/user.png', Profile: { avatarUrl: '/uploads/profile.png' } } } : null
  })
  try {
    const enriched = await getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'owner')
    assert.equal(enriched.activityStartsAt, null)
    assert.equal(enriched.activityEndsAt, instant.toISOString())
    assert.equal(enriched.avatarUrl, '/uploads/profile.png')
    for (const key of Object.keys(stored).filter((key) => key !== 'poster')) assert.deepEqual(enriched[key], stored[key as keyof typeof stored])
    assert.deepEqual(enriched.poster, { showNickname: false, backgroundUrl: '/uploads/old.png', showQrCode: false }, 'missing current flags are private and the legacy shared-background fallback is read-only')
    assert.equal(Object.hasOwn(stored, 'avatarUrl'), false)
    await assert.rejects(getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'other'), { code: 'TEST_RESULT_NOT_FOUND' })
  } finally { Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', original) }
})

let directory = '', avatarUrl = ''
before(async () => {
  await mkdir(join(process.cwd(), 'public/uploads'), { recursive: true })
  directory = await mkdtemp(join(process.cwd(), 'public/uploads/poster-v4-test-'))
  avatarUrl = '/uploads/' + directory.split(/[\\/]/u).pop() + '/avatar.png'
  await writeFile(join(directory, 'avatar.png'), await sharp({ create: { width: 300, height: 160, channels: 4, background: '#22dd44' } }).png().toBuffer())
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

test('avatar is real image bytes cropped into a circle; nickname toggle hides the whole identity group', async () => {
  const value = { title: '真实结果', nickname: '测试会员', avatarUrl, poster: { showNickname: true } }
  const png = await renderTopicV2Poster(value, 'activity-one')
  const pixel = async (left: number, top: number, bytes = png) => [...await sharp(bytes).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
  assert.deepEqual(await pixel(TOPIC_POSTER_AVATAR.left + TOPIC_POSTER_AVATAR.size / 2, TOPIC_POSTER_AVATAR.top + TOPIC_POSTER_AVATAR.size / 2), [34, 221, 68])
  assert.notDeepEqual(await pixel(TOPIC_POSTER_AVATAR.left, TOPIC_POSTER_AVATAR.top), [34, 221, 68], 'circle clipping excludes square corners')
  const hidden = await renderTopicV2Poster({ ...value, poster: { showNickname: false } }, 'activity-one')
  assert.notDeepEqual(await pixel(TOPIC_POSTER_AVATAR.left + TOPIC_POSTER_AVATAR.size / 2, TOPIC_POSTER_AVATAR.top + TOPIC_POSTER_AVATAR.size / 2, hidden), [34, 221, 68])
})

test('missing, external, private or malformed avatars degrade to a local initial without failing PNG', async () => {
  for (const value of [undefined, '/uploads/does-not-exist.png', '/uploads/profile/private.png', 'http://127.0.0.1:9/avatar.png', 'https://evil.invalid/x.png', '/cos/topic-activity/private/a.png', '/uploads/%2e%2e/secret.png']) {
    const png = await renderTopicV2Poster({ title: '结果', nickname: '会员', avatarUrl: value }, 'a')
    assert.deepEqual(await sharp(png).metadata().then((metadata) => [metadata.width, metadata.height]), [1080, 1440])
  }
})

test('repeated fallback renders retain real title ink and a decodable QR, not just paper placeholders', async () => {
  for (let i = 0; i < 2; i++) {
    const png = await renderTopicV2Poster({ title: '新演唱会肯定有票！', nickname: '会员', poster: { showNickname: true, showQrCode: true } }, 'local-preview-only')
    const { left, top, size } = topicPosterQr({ showNickname: true, showQrCode: true })
    const { data, info } = await sharp(png).extract({ left, top, width: size, height: size }).greyscale().raw().toBuffer({ resolveWithObject: true })
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))
    assert.equal(new QRCodeReader().decode(bitmap).getText(), 'https://ecfc.fans/activities/local-preview-only')
    const ink = await sharp(png).extract({ left: 118, top: TOPIC_POSTER_RESULT.top + 25, width: 820, height: 80 }).removeAlpha().raw().toBuffer()
    let dark = 0
    for (let p = 0; p < ink.length; p += 3) if (ink[p] < 80 && ink[p + 1] < 80 && ink[p + 2] < 80) dark++
    assert.ok(dark > 1000, 'result title must visibly render')
  }
})

test('official ECFC logo is centred on white; H modules and quiet zone outside its small plate remain unchanged', async () => {
  const target = 'https://ecfc.fans/activities/local-qr-brand-qa'
  const png = await renderTopicV2Poster({ title: '品牌验收', poster: { showQrCode: true } }, 'local-qr-brand-qa')
  const { left, top, size } = topicPosterQr({ showQrCode: true })
  const qr = await sharp(png).extract({ left, top, width: size, height: size }).ensureAlpha().raw().toBuffer()
  const plain = await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: await QRCode.toBuffer(target, { width: size - 24, margin: 4, errorCorrectionLevel: 'H' }), left: 12, top: 12 }])
    .raw().toBuffer()
  const { logoSize, plateSize: logoPlateSize } = TOPIC_POSTER_QR_BRAND
  const plateStart = (size - logoPlateSize) / 2, plateEnd = plateStart + logoPlateSize
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x >= plateStart && x < plateEnd && y >= plateStart && y < plateEnd) continue
    const offset = (y * size + x) * 4
    assert.ok(qr.subarray(offset, offset + 4).equals(plain.subarray(offset, offset + 4)), 'all H modules and quiet zone outside the centre are preserved')
  }
  const official = await sharp(readFileSync(join(process.cwd(), 'public/icons/icon-512.png')))
    .resize(logoSize, logoSize, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer()
  const centre = await sharp(png).extract({ left: left + (size - logoSize) / 2, top: top + (size - logoSize) / 2, width: logoSize, height: logoSize }).ensureAlpha().raw().toBuffer()
  assert.deepEqual(centre, official, 'actual pixels must be the official logo, not a text placeholder')
  assert.ok(logoSize / size <= .20, 'logo subject occupies no more than 20%')
  assert.notDeepEqual(qr, plain)
  for (const bytes of [qr, plain]) {
    const grey = await sharp(bytes, { raw: { width: size, height: size, channels: 4 } }).greyscale().removeAlpha().raw().toBuffer()
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(grey), size, size)))
    assert.equal(new QRCodeReader().decode(bitmap).getText(), target, 'before and after logo decode to the same activity')
  }
})

test('preview/download/share continue using one authenticated PNG endpoint, no new image upload field', () => {
  const ui = readFileSync(join(process.cwd(), 'components/activities/TopicActivityV2Interactive.tsx'), 'utf8')
  assert.match(ui, /poster/); assert.match(ui, /navigator\.share/)
  const route = readFileSync(join(process.cwd(), 'app/api/activities/[activityId]/v2/attempts/[attemptId]/poster/route.ts'), 'utf8')
  assert.match(route, /requireRequestUser/); assert.match(route, /getTopicV2PosterSnapshot\(activityId, attemptId, guard.user.id\)/)
  assert.match(route, /renderTopicV2Poster\(snapshot, activityId\)/)
  assert.match(route, /image\/png/)
})

test('actual poster GET rejects anonymous/foreign attempts and returns a private PNG for its owner', async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const loader = require('node:module') as { _load: (name: string, parent: unknown, main: boolean) => unknown }
  const originalLoad = loader._load, originalFind = prisma.topicActivityTestAttempt.findFirst
  let caller: string | null = null, reads = 0
  Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async ({ where }: { where: { id: string; activityId: string; userId: string } }) => {
    reads++
    return where.id === 'attempt-one' && where.activityId === 'activity-one' && where.userId === 'owner' ? {
      resultSnapshot: { title: '真实测试结果', testTitle: '冻结测试名', poster: { showQrCode: true } },
      Activity: { startsAt: instant, endsAt: instant }, User: { avatarUrl: null, Profile: null },
    } : null
  })
  loader._load = function (name, parent, main) {
    if (name === '@/lib/security') return { requireRequestUser: async () => caller ? { user: { id: caller } } : { user: null, response: new Response('', { status: 401 }) } }
    return originalLoad.call(this, name, parent, main)
  }
  try {
    let route: typeof import('../app/api/activities/[activityId]/v2/attempts/[attemptId]/poster/route')
    try { route = require('./app/api/activities/[activityId]/v2/attempts/[attemptId]/poster/route.ts') }
    finally { loader._load = originalLoad }
    const invoke = (activityId = 'activity-one', attemptId = 'attempt-one') => route.GET(new Request('http://localhost/api/local'), { params: Promise.resolve({ activityId, attemptId }) })
    assert.equal((await invoke()).status, 401); assert.equal(reads, 0)
    caller = 'other'; assert.equal((await invoke()).status, 404)
    caller = 'owner'; assert.equal((await invoke('other-activity')).status, 404)
    assert.equal((await invoke('activity-one', 'other-attempt')).status, 404)
    const response = await invoke()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') || '', /private.*no-store/)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(Number(response.headers.get('content-length')), bytes.length)
    assert.deepEqual(await sharp(bytes).metadata().then((m) => [m.width, m.height]), [1080, 1440])
  } finally { loader._load = originalLoad; Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', originalFind) }
})
