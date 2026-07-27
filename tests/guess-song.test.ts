import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  GUESS_SONG_MODE_CONFIG,
  calculateGuessSongScore,
  getEndlessDurationMultiplier,
  getPlaybackRatio,
  getStreakMultiplier,
} from '../lib/guess-song-config'
import { getFfmpegPath, processGuessSongAudio } from '../lib/guess-song-audio'
import { compareGuessSongScores, getGuessSongPeriod, isGuessSongScoreBetter } from '../lib/guess-song-period'
import { canEnableGuessSongQuestion, parseGuessSongQuestionInput } from '../lib/guess-song-questions'
import {
  createGuessSongStorageAdapter,
  getGuessSongObjectMetadata,
  type GuessSongCosClient,
} from '../lib/guess-song-storage'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function createMockCosClient(overrides: Partial<GuessSongCosClient> = {}) {
  const calls = {
    put: [] as Array<Record<string, unknown>>,
    getUrl: [] as Array<Record<string, unknown>>,
    head: [] as Array<Record<string, unknown>>,
    deleted: [] as string[],
  }
  const client: GuessSongCosClient = {
    async putObject(params) {
      calls.put.push(params)
      return {}
    },
    async getObject() {
      return { Body: Buffer.from('audio') }
    },
    async headObject(params) {
      calls.head.push(params)
      return {
        ETag: '"etag"',
        headers: { 'content-length': '5', 'content-type': 'audio/mpeg' },
      }
    },
    async deleteObject(params) {
      calls.deleted.push(params.Key)
      return {}
    },
    async deleteMultipleObject(params) {
      calls.deleted.push(...params.Objects.map((item) => item.Key))
      return {}
    },
    getObjectUrl(params) {
      calls.getUrl.push(params)
      return `https://private.example/${params.Key}?q-signature=temporary`
    },
    ...overrides,
  }
  return { client, calls }
}

function createCosAdapter(client: GuessSongCosClient) {
  return createGuessSongStorageAdapter(client, {
    bucket: 'example-1250000000',
    region: 'ap-guangzhou',
    prefix: 'guess-song',
    signedUrlExpires: 90,
  })
}

test('简单模式每题最多播放2次', () => assert.equal(GUESS_SONG_MODE_CONFIG.EASY.maxPlayCount, 2))
test('进阶模式每题最多播放3次', () => assert.equal(GUESS_SONG_MODE_CONFIG.ADVANCED.maxPlayCount, 3))
test('困难模式每题最多播放5次', () => assert.equal(GUESS_SONG_MODE_CONFIG.HARD.maxPlayCount, 5))
test('无尽模式每题最多播放5次且初始规则不使用终极名称', () => {
  assert.equal(GUESS_SONG_MODE_CONFIG.ENDLESS.maxPlayCount, 5)
  assert.equal(GUESS_SONG_MODE_CONFIG.ENDLESS.label, '无尽')
})

test('并发播放由条件更新和唯一幂等键双重限制', () => {
  const service = source('lib/guess-song-session.ts')
  const schema = source('prisma/schema.prisma')
  assert.match(service, /playCount: \{ lt: playable\.sessionQuestion\.maxPlayCount \}/)
  assert.match(service, /playCount: \{ increment: 1 \}/)
  assert.match(schema, /@@unique\(\[sessionQuestionId, requestKey\]\)/)
})

test('答题前响应只包含临时 publicId 和选项，不暴露真实 questionId 或正确 key', () => {
  const service = source('lib/guess-song-session.ts')
  const serialized = service.slice(service.indexOf('question: session.status'), service.indexOf('async function getPlayableVariant'))
  assert.match(serialized, /publicId: currentQuestion\.publicId/)
  assert.match(serialized, /options: parseOptions/)
  assert.doesNotMatch(serialized, /questionId:/)
  assert.doesNotMatch(serialized, /correctOptionKey:/)
})

test('每道题通过 answeredAt 与 selectedOptionKey 条件只能提交一次', () => {
  const service = source('lib/guess-song-session.ts')
  assert.match(service, /selectedOptionKey: null, answeredAt: null/)
  assert.match(service, /duplicate: true/)
})

test('播放次数扣分比例正确', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(getPlaybackRatio), [1, 0.9, 0.8, 0.7, 0.6])
})

test('连击倍率边界正确', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9, 10].map(getStreakMultiplier), [1, 1, 1.2, 1.2, 1.5, 1.5, 2])
})

test('无尽模式音频长度倍率正确', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7].map(getEndlessDurationMultiplier), [2.5, 2, 1.5, 1.2, 1, 1])
})

test('服务端综合计分会取整数并组合播放与连击倍率', () => {
  assert.equal(calculateGuessSongScore({ mode: 'HARD', playCount: 2, streak: 3, durationSeconds: 2, correct: true }), 324)
  assert.equal(calculateGuessSongScore({ mode: 'ENDLESS', playCount: 1, streak: 10, durationSeconds: 2, correct: true }), 600)
  assert.equal(calculateGuessSongScore({ mode: 'EASY', playCount: 1, streak: 1, durationSeconds: 7, correct: false }), 0)
})

test('无尽答错扣除机会且归零完成场次', () => {
  const service = source('lib/guess-song-session.ts')
  assert.match(service, /Math\.max\(0, question\.session\.livesRemaining - 1\)/)
  assert.match(service, /livesRemaining === 0/)
})

test('普通模式严格在第10题完成', () => {
  assert.equal(GUESS_SONG_MODE_CONFIG.EASY.questionCount, 10)
  assert.equal(GUESS_SONG_MODE_CONFIG.ADVANCED.questionCount, 10)
  assert.equal(GUESS_SONG_MODE_CONFIG.HARD.questionCount, 10)
})

test('未完成场次不写排行榜', () => {
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  assert.match(leaderboard, /session\.status !== 'COMPLETED'/)
})

test('周榜按北京时间周一切换', () => {
  assert.equal(getGuessSongPeriod('WEEK', new Date('2026-07-26T15:59:59Z')).periodKey, '2026-07-20')
  assert.equal(getGuessSongPeriod('WEEK', new Date('2026-07-26T16:00:00Z')).periodKey, '2026-07-27')
})

test('月榜按北京时间每月1日切换', () => {
  assert.equal(getGuessSongPeriod('MONTH', new Date('2026-07-31T15:59:59Z')).periodKey, '2026-07')
  assert.equal(getGuessSongPeriod('MONTH', new Date('2026-07-31T16:00:00Z')).periodKey, '2026-08')
})

test('同一用户同周期同模式只有一条最好成绩', () => {
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /@@unique\(\[userId, mode, periodType, periodKey\]\)/)
})

test('排行榜并列依次比较分数、答对、连击、播放次数和更早达成', () => {
  const base = { score: 100, correctCount: 5, maxStreak: 3, totalPlayCount: 8, achievedAt: new Date('2026-07-27T01:00:00Z') }
  assert.ok(compareGuessSongScores({ ...base, score: 101 }, base) < 0)
  assert.ok(compareGuessSongScores({ ...base, correctCount: 6 }, base) < 0)
  assert.ok(compareGuessSongScores({ ...base, maxStreak: 4 }, base) < 0)
  assert.ok(compareGuessSongScores({ ...base, totalPlayCount: 7 }, base) < 0)
  assert.equal(isGuessSongScoreBetter({ ...base, score: 101 }, base), true)
})

test('普通用户不能进入后台题库', () => {
  const page = source('app/admin/entertainment/guess-song/page.tsx')
  const route = source('app/api/admin/entertainment/guess-song/questions/route.ts')
  assert.match(page, /requireAdminPage\([^)]*'entertainment_manage'/)
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
})

test('停用题目不会进入新游戏', () => {
  const service = source('lib/guess-song-session.ts')
  assert.match(service, /enabled: true/)
  assert.match(service, /processingStatus: 'READY'/)
})

test('已有历史记录题目不能物理删除', () => {
  const route = source('app/api/admin/entertainment/guess-song/questions/[questionId]/route.ts')
  assert.match(route, /sessionQuestions/)
  assert.match(route, /已有历史游戏记录，请停用而不是删除/)
})

test('过期场次不能继续播放或答题', () => {
  const service = source('lib/guess-song-session.ts')
  assert.ok((service.match(/SESSION_EXPIRED/g) || []).length >= 3)
  assert.match(service, /expiresAt: \{ gt: now \}/)
})

test('用户不能访问其他人的场次', () => {
  const service = source('lib/guess-song-session.ts')
  assert.match(service, /session\.userId !== userId/)
  assert.match(service, /session\.userId !== input\.userId/)
})

test('签名地址只由服务端当前题对应变体路径生成', () => {
  const service = source('lib/guess-song-session.ts')
  const route = source('app/api/entertainment/guess-song/sessions/[sessionId]/play/route.ts')
  assert.match(service, /createGuessSongSignedUrl\(playable\.variant\.storagePath, signedUrlExpires\)/)
  assert.doesNotMatch(route, /storagePath/)
})

test('深色模式下游戏文字与答案使用现有主题变量', () => {
  const css = source('app/globals.css')
  assert.match(css, /\.guess-song-options button/)
  assert.match(css, /color:var\(--foreground\)/)
  assert.match(css, /background:var\(--surface-elevated\)/)
})

test('四个答案不能为空且不区分英文大小写去重', () => {
  const valid = parseGuessSongQuestionInput({
    songTitle: '测试歌曲',
    difficulty: 'EASY',
    correctAnswer: 'Answer',
    wrongOption1: 'One',
    wrongOption2: 'Two',
    wrongOption3: 'Three',
  })
  assert.equal(valid.ok, true)
  const duplicate = parseGuessSongQuestionInput({
    songTitle: '测试歌曲',
    difficulty: 'EASY',
    correctAnswer: 'Answer',
    wrongOption1: ' answer ',
    wrongOption2: 'Two',
    wrongOption3: 'Three',
  })
  assert.equal(duplicate.ok, false)
})

test('题目启用前必须音频就绪且包含模式所需变体', () => {
  assert.equal(canEnableGuessSongQuestion({
    processingStatus: 'READY',
    difficulty: 'EASY',
    allowEndless: false,
    variantDurations: [7],
  }), true)
  assert.equal(canEnableGuessSongQuestion({
    processingStatus: 'READY',
    difficulty: 'EASY',
    allowEndless: true,
    variantDurations: [7],
  }), false)
})

test('同一用户同模式进行中场次由 activeKey 唯一约束防并发创建', () => {
  const schema = source('prisma/schema.prisma')
  const service = source('lib/guess-song-session.ts')
  assert.match(schema, /activeKey\s+String\?\s+@unique/)
  assert.match(service, /activeKey: `\$\{userId\}:\$\{mode\}`/)
})

test('第一版不发放或扣除积分经验', () => {
  const service = source('lib/guess-song-session.ts')
  assert.doesNotMatch(service, /pointLog|experienceLog|points:\s*\{\s*increment/)
})

test('源音频和2至7秒变体通过COS私有对象上传', async () => {
  const { client, calls } = createMockCosClient()
  const adapter = createCosAdapter(client)
  const keys = [
    'guess-song/questions/q1/source/revision.mp3',
    ...[2, 3, 4, 5, 6, 7].map((duration) =>
      `guess-song/questions/q1/variants/revision/${duration}s.mp3`),
  ]
  for (const key of keys) {
    await adapter.upload({ key, body: Buffer.from('audio') })
  }
  assert.deepEqual(calls.put.map((call) => call.Key), keys)
  assert.ok(calls.put.every((call) =>
    call.ACL === 'private' && call.ContentType === 'audio/mpeg'))
})

test('数据库只保存COS对象Key而不是永久URL', () => {
  const audio = source('lib/guess-song-admin-audio.ts')
  assert.match(audio, /buildGuessSongObjectKey/)
  assert.match(audio, /sourceAudioPath/)
  assert.match(audio, /storagePath/)
  assert.doesNotMatch(audio, /https?:\/\//)
})

test('用户播放使用环境变量有效期的COS临时签名URL', () => {
  const service = source('lib/guess-song-session.ts')
  assert.match(service, /getGuessSongSignedUrlExpires\(\)/)
  assert.match(service, /createGuessSongSignedUrl\(playable\.variant\.storagePath, signedUrlExpires\)/)
  assert.doesNotMatch(service, /createGuessSongSignedUrl\([^)]*20\)/)
})

test('答题前响应和播放路由都不暴露对象Key', () => {
  const service = source('lib/guess-song-session.ts')
  const route = source('app/api/entertainment/guess-song/sessions/[sessionId]/play/route.ts')
  const serialized = service.slice(service.indexOf('question: session.status'), service.indexOf('async function getPlayableVariant'))
  assert.doesNotMatch(serialized, /storagePath|sourceAudioPath/)
  assert.doesNotMatch(route, /storagePath|sourceAudioPath|cosKey|objectKey/)
})

test('后台试听仅签名数据库所属题目的变体且不增加播放次数', () => {
  const preview = source('app/api/admin/entertainment/guess-song/questions/[questionId]/preview/route.ts')
  assert.match(preview, /questionId_durationSeconds/)
  assert.match(preview, /createGuessSongSignedUrl\(variant\.storagePath, expiresIn\)/)
  assert.doesNotMatch(preview, /playCount.*increment|guessSongPlayRequest/)
})

test('后台题库采用创建后上传的两步流程并复用现有音频接口', () => {
  const admin = source('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')
  assert.match(admin, /题目已创建，请上传至少7秒的音频片段/)
  assert.match(admin, /setActiveUploadId\(data\.question\.id\)/)
  assert.match(admin, /scrollIntoView/)
  assert.match(admin, /上传并生成音频片段/)
  assert.match(admin, /questions\/\$\{question\.id\}\/audio/)
  assert.match(admin, /questions\/\$\{question\.id\}\/regenerate/)
})

test('后台上传前校验格式、20MB与至少7秒时长', () => {
  const admin = source('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')
  assert.match(admin, /mp3\|m4a\|wav\|aac/)
  assert.match(admin, /20 \* 1024 \* 1024/)
  assert.match(admin, /duration < 7/)
  assert.match(admin, /正在生成 2～7 秒片段/)
  assert.match(admin, /正在上传腾讯云 COS/)
})

test('后台试听单实例播放且启用按钮展示具体缺失原因', () => {
  const admin = source('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')
  assert.match(admin, /previewAudioRef\.current\?\.pause\(\)/)
  assert.match(admin, /playingKey === key/)
  assert.match(admin, /audio\.onended = stopPreview/)
  assert.match(admin, /缺少 \$\{missing\.join\('、'\)\} 秒音频变体/)
  assert.match(admin, /暂不能启用：\{enableBlockReason\}/)
})

test('上传部分失败会清理本次已上传的COS对象', () => {
  const audio = source('lib/guess-song-admin-audio.ts')
  assert.match(audio, /uploadedPaths\.push/)
  assert.match(audio, /catch \(error\) \{[\s\S]*?await deleteGuessSongObjects\(uploadedPaths\)/)
})

test('重传先提交新对象Key再清理旧COS对象', () => {
  const audio = source('lib/guess-song-admin-audio.ts')
  const transaction = audio.indexOf('await prisma.$transaction')
  const cleanupOld = audio.indexOf('await deleteGuessSongObjects(oldPaths)')
  assert.ok(transaction >= 0 && cleanupOld > transaction)
  assert.match(audio, /randomUUID\(\)/)
})

test('删除无历史题目先清理COS对象再删除数据库记录', () => {
  const route = source('app/api/admin/entertainment/guess-song/questions/[questionId]/route.ts')
  const storageDelete = route.indexOf('await deleteGuessSongObjects(paths)')
  const databaseDelete = route.indexOf('await prisma.guessSongQuestion.delete')
  assert.ok(storageDelete >= 0 && databaseDelete > storageDelete)
  assert.match(route, /_count\.sessionQuestions > 0/)
})

test('COS HeadObject用于对象存在与元数据检查', async () => {
  const { client, calls } = createMockCosClient()
  const metadata = await createCosAdapter(client).metadata('guess-song/questions/q1/variants/r/7s.mp3')
  assert.equal(calls.head.length, 1)
  assert.equal(metadata?.contentLength, 5)
  assert.equal(metadata?.contentType, 'audio/mpeg')
})

test('COS短时签名仅包含指定对象Key并默认90秒', () => {
  const { client, calls } = createMockCosClient()
  const url = createCosAdapter(client).signedUrl('guess-song/questions/q1/variants/r/4s.mp3')
  assert.match(url, /q-signature=temporary/)
  assert.equal(calls.getUrl[0].Expires, 90)
  assert.equal(calls.getUrl[0].Method, 'GET')
  assert.equal(calls.getUrl[0].Key, 'guess-song/questions/q1/variants/r/4s.mp3')
})

test('COS未配置时返回明确错误且模块导入不会崩溃', async () => {
  const names = [
    'TENCENT_COS_SECRET_ID',
    'TENCENT_COS_SECRET_KEY',
    'TENCENT_COS_BUCKET',
    'TENCENT_COS_REGION',
  ] as const
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  names.forEach((name) => delete process.env[name])
  await assert.rejects(
    () => getGuessSongObjectMetadata('guess-song/test.mp3'),
    /腾讯云 COS 音频存储尚未配置/,
  )
  names.forEach((name) => {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  })
})

test('COS SDK保持服务端外置且不进入客户端组件依赖', () => {
  const config = source('next.config.ts')
  const storage = source('lib/guess-song-storage.ts')
  const userClient = source('app/entertainment/guess-song/GuessSongGame.tsx')
  const adminClient = source('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')
  assert.match(config, /'cos-nodejs-sdk-v5'/)
  assert.match(storage, /import COS from 'cos-nodejs-sdk-v5'/)
  assert.doesNotMatch(userClient, /guess-song-storage|cos-nodejs-sdk-v5/)
  assert.doesNotMatch(adminClient, /guess-song-storage|cos-nodejs-sdk-v5/)
})

test('FFmpeg 可生成精确的2至7秒 MP3变体并清理临时文件', { timeout: 120_000 }, async () => {
  const generated = spawnSync(getFfmpegPath(), [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '8', '-f', 'wav', 'pipe:1',
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  assert.equal(generated.status, 0)
  const result = await processGuessSongAudio(generated.stdout, 'wav')
  assert.ok(result.durationMs >= 7900)
  assert.deepEqual(result.variants.map((variant) => variant.durationSeconds), [2, 3, 4, 5, 6, 7])
  assert.ok(result.variants.every((variant) => variant.buffer.byteLength > 1000))
})
