import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCantoneseFragmentQuestion,
  buildFalseTitleQuestion,
  buildWantListenQuestion,
  validateQuestion,
  type WantListenSongCandidate,
} from '../lib/want-listen-questions'
import { cleanLyrics, hasSufficientLyricContext, isValidLyricContext, lyricContextParts, selectLyricFragment, selectSafeLyricSnippet, type LyricFragment } from '../lib/want-listen-lyrics'
import { difficultyForQuestion, scoreForWantListenAnswer } from '../lib/want-listen-config'
import { compareWantListenScores } from '../lib/want-listen-period'
import { normalizeWantListenTitle } from '../lib/want-listen-title'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

// 与 WantListenGame.hintText 等价的纯函数，仅用于断言线索文本。
function hintTextFromHint(hint: Record<string, unknown>) {
  if (typeof hint.text === 'string') return hint.text
  if (hint.type === 'album-cover' && typeof hint.albumName === 'string') return `专辑：《${hint.albumName}》`
  if (hint.type === 'credit' && typeof hint.label === 'string' && typeof hint.value === 'string') return `${hint.label}：${hint.value}`
  return ''
}

function song(id: string, title: string, lyrics: string, language = '粤语', releaseYear = 2006): WantListenSongCandidate {
  return {
    id,
    title,
    releaseYear,
    language,
    lyricist: '黄伟文',
    composer: 'Eric Kwok',
    arranger: null,
    producer: null,
    lyrics,
    description: null,
    story: null,
    album: { id: `album-${id}`, name: `专辑 ${id}`, releaseYear, language, coverUrl: null },
  }
}

test('想听的歌曲题有四个唯一真实歌名选项，并提供四层逐步线索（年份语言/专辑/作词/作曲）', () => {
  const target = song('target', '目标之歌', '夜色很长仍然想你\n街灯照着没有标题的句子')
  const pool = [
    target,
    song('wrong-1', '相近时期一', '另一句歌词内容足够长'),
    song('wrong-2', '相近时期二', '再另一句歌词内容足够长'),
    song('wrong-3', '相近时期三', '还有另一句歌词内容足够长'),
  ]
  const question = buildWantListenQuestion(target, pool, () => 0.31)
  assert.ok(question)
  assert.equal(question.data.options.length, 4)
  assert.equal(new Set(question.data.options.map((option) => normalizeWantListenTitle(option.label))).size, 4)
  const hints = question.data.hints || []
  assert.equal(hints.length, 4)
  // 线索1：年份 + 语言
  assert.equal(hints[0].type, 'year-language')
  assert.match(String(hints[0].text), /·/)
  // 线索2：专辑（无封面时仅专辑名，不重复年份）
  assert.ok(hints[1].type === 'album-cover' || hints[1].type === 'album-text')
  assert.match(hintTextFromHint(hints[1]), /专辑/)
  assert.doesNotMatch(hintTextFromHint(hints[1]), /\d{4}/)
  // 线索3：作词人
  assert.equal(hints[2].type, 'credit')
  assert.equal(hints[2].label, '作词')
  assert.equal(hints[2].value, '黄伟文')
  // 线索4：作曲人
  assert.equal(hints[3].type, 'credit')
  assert.equal(hints[3].label, '作曲')
  assert.equal(hints[3].value, 'Eric Kwok')
  // 每一步线索提供全新信息，彼此不重复（专辑/作词/作曲与年份语言无重叠）
  assert.notEqual(hintTextFromHint(hints[2]), hintTextFromHint(hints[3]))
  assert.deepEqual(scoreForWantListenAnswer(true, 1), 100)
  assert.deepEqual(scoreForWantListenAnswer(true, 9), 100)
  assert.deepEqual(scoreForWantListenAnswer(true, 10), 370)   // 基础 100 + 连击奖励 270
  assert.deepEqual(scoreForWantListenAnswer(true, 20), 370)
  assert.deepEqual(scoreForWantListenAnswer(false, 1), 0)      // 答错 0 分
})

test('想听线索在歌曲资料缺失时自动跳过，不产生空内容', () => {
  const sparse = {
    ...song('sparse', '稀少奇歌', '歌词一行\n歌词二行'),
    album: { id: 'a', name: '', releaseYear: 2000, language: '国语', coverUrl: null },
    lyricist: null,
    composer: null,
    description: null,
    story: null,
  }
  const pool = [sparse, song('w1', '甲', '歌词'), song('w2', '乙', '歌词'), song('w3', '丙', '歌词')]
  const question = buildWantListenQuestion(sparse, pool, () => 0.31)
  assert.ok(question)
  // 仅保留年份+语言线索，专辑/作词/作曲均因缺失被跳过
  assert.equal((question.data.hints || []).length, 1)
  assert.equal((question.data.hints || [])[0].type, 'year-language')
  // 完整线索（歌曲介绍）缺失则不展示
  assert.equal(question.data.completeContext, undefined)
})

test('想听最终线索展示歌曲介绍（description 优先，回退 story）', () => {
  const withStory = {
    ...song('story', '介绍之歌', '歌词一行\n歌词二行'),
    description: null,
    story: '这首歌讲述了一段归途。',
  }
  const withDesc = {
    ...song('desc', '介绍之二', '歌词一行\n歌词二行'),
    description: '官方简介内容。',
    story: '应被覆盖的 story。',
  }
  const qStory = buildWantListenQuestion(withStory, [withStory, song('w1', '甲', '歌词'), song('w2', '乙', '歌词'), song('w3', '丙', '歌词')], () => 0.31)
  const qDesc = buildWantListenQuestion(withDesc, [withDesc, song('w1', '甲', '歌词'), song('w2', '乙', '歌词'), song('w3', '丙', '歌词')], () => 0.31)
  assert.ok(qStory)
  assert.ok(qDesc)
  assert.equal(qStory.data.completeContext, '这首歌讲述了一段归途。')
  assert.equal(qDesc.data.completeContext, '官方简介内容。')
})

test('歌词清洗会移除 LRC 时间轴、metadata、署名和无意义语气词', () => {
  const lines = cleanLyrics('[ar:陈奕迅]\n[00:12.30]啊\n[00:15.00]谁都只得那双手\n作词：黄伟文\n\n靠拥抱亦难任你拥有')
  assert.deepEqual(lines, ['谁都只得那双手', '靠拥抱亦难任你拥有'])
  assert.equal(selectSafeLyricSnippet(lines, '不存在的歌名'), '靠拥抱亦难任你拥有')
})

test('歌词上下文有效性会拒绝分隔符、时间轴、空白和过短单侧上下文', () => {
  assert.equal(isValidLyricContext('——'), false)
  assert.equal(isValidLyricContext('......'), false)
  assert.equal(isValidLyricContext('[00:13.20]'), false)
  assert.equal(isValidLyricContext('仍然在呼吸'), true)
  assert.equal(hasSufficientLyricContext('', ''), false)
  assert.equal(hasSufficientLyricContext('——', ''), false)
  assert.equal(hasSufficientLyricContext('...', '   '), false)
  assert.equal(hasSufficientLyricContext('[00:13.20]', '——'), false)
  assert.equal(hasSufficientLyricContext('何来内心交战', ''), false)
  assert.equal(hasSufficientLyricContext('上一句歌词\n再上一句歌词', ''), true)
  assert.equal(hasSufficientLyricContext('', '下一句歌词\n再下一句歌词'), true)
  assert.equal(hasSufficientLyricContext('上一句歌词', '下一句歌词'), true)
})

test('粤语残片使用连续自然片段，四个歌词选项唯一', () => {
  const target = song('target', '粤语目标', '再上一句有效歌词\n谁都只得那双手\n靠拥抱亦难任你拥有\n再下一句有效歌词')
  const pool = [
    target,
    song('other-1', '粤语一', '再上一句明明相隔很远\n明明相隔很远\n仍然记得你的声音\n再下一句仍然记得你'),
    song('other-2', '粤语二', '再上一句如果这都不算爱\n如果这都不算爱\n还有什么值得等\n再下一句值得去等'),
    song('other-3', '粤语三', '再上一句沿途风光都很好\n沿途风光都很好\n只是少了你的拥抱\n再下一句你的拥抱'),
  ]
  const question = buildCantoneseFragmentQuestion(target, pool, 1, () => 0.27)
  assert.ok(question)
  assert.equal(question.data.options.length, 4)
  assert.equal(new Set(question.data.options.map((option) => normalizeWantListenTitle(option.label))).size, 4)
  assert.match(question.data.maskedContext || '', /____/u)
  // 隐藏句随机落在窗口中的任意一句，因此 before/after 中有一侧可能为空；
  // 只要任意一侧存在上下文（配合 validateQuestion 的充足性校验）即可。
  assert.ok(question.data.beforeContext || question.data.afterContext)
  assert.equal(question.data.maskedContext?.split('\n').length, 3, '歌词窗口固定三句')
  assert.ok(question.data.completeContext)
  assert.ok(question.data.correctLyric)
  assert.equal(validateQuestion(question.data), true)
  assert.equal(selectLyricFragment(cleanLyrics(target.lyrics), 1)?.context.includes('____'), true)
})

test('粤语残片会在候选生成前清除空白歌词行、标签和纯符号行', () => {
  assert.deepEqual(
    cleanLyrics('——\n...\n[00:13.20]\n[副歌]\n<html>\n仍然在呼吸\n   '),
    ['仍然在呼吸'],
  )
})

test('历史粤语残片题的上下文校验失败时不会被视为有效题', () => {
  const base = {
    kind: 'cantonese-fragment' as const,
    options: [
      { key: 'correct', label: '仍然在呼吸' },
      { key: 'wrong-1', label: '曾经爱过你' },
      { key: 'wrong-2', label: '仍然记得你' },
      { key: 'wrong-3', label: '再见旧时光' },
    ],
    correctLyric: '仍然在呼吸',
    completeContext: '仍然在呼吸',
  }
  assert.equal(validateQuestion({ ...base, maskedContext: '____', beforeContext: '', afterContext: '' }), false)
  assert.equal(validateQuestion({ ...base, maskedContext: '——', beforeContext: '——', afterContext: '' }), false)
  assert.equal(validateQuestion({ ...base, maskedContext: '上一句\n____', beforeContext: '上一句', afterContext: '' }), false)
  assert.equal(validateQuestion({ ...base, maskedContext: '上一句\n再上一句\n____', beforeContext: '上一句\n再上一句', afterContext: '' }), true)
})

test('粤语残片歌词展示固定三句：上一句 / 隐藏目标 / 下一句', () => {
  const lines = ['第一句有效歌词', '第二句有效歌词', '第三句有效歌词', '第四句有效歌词', '第五句有效歌词']
  const fragment: LyricFragment = {
    answer: '第三句',
    context: '第三句有效歌词'.replace('第三句', '____'),
    sourceLine: '第三句有效歌词',
    lineIndex: 2,
  }
  const parts = lyricContextParts(lines, fragment)
  const maskedLines = parts.masked.split('\n')
  assert.equal(maskedLines.length, 3)
  assert.equal(maskedLines[0], '第二句有效歌词')
  assert.equal(maskedLines[1], '____有效歌词')
  assert.equal(maskedLines[2], '第四句有效歌词')
  assert.equal(parts.complete.split('\n').length, 3)
  assert.equal(parts.before, '第二句有效歌词')
  assert.equal(parts.after, '第四句有效歌词')
})

test('粤语残片在歌曲开头边界时向后补足两句', () => {
  const lines = ['第一句有效歌词', '第二句有效歌词', '第三句有效歌词']
  const fragment: LyricFragment = {
    answer: '第一句',
    context: '____有效歌词',
    sourceLine: '第一句有效歌词',
    lineIndex: 0,
  }
  const parts = lyricContextParts(lines, fragment)
  const maskedLines = parts.masked.split('\n')
  assert.equal(maskedLines.length, 3)
  assert.equal(maskedLines[0], '____有效歌词')
  assert.equal(maskedLines[1], '第二句有效歌词')
  assert.equal(maskedLines[2], '第三句有效歌词')
})

test('粤语残片在歌曲结尾边界时向前补足两句', () => {
  const lines = ['第一句有效歌词', '第二句有效歌词', '第三句有效歌词']
  const fragment: LyricFragment = {
    answer: '第三句',
    context: '____有效歌词',
    sourceLine: '第三句有效歌词',
    lineIndex: 2,
  }
  const parts = lyricContextParts(lines, fragment)
  const maskedLines = parts.masked.split('\n')
  assert.equal(maskedLines.length, 3)
  assert.equal(maskedLines[0], '第一句有效歌词')
  assert.equal(maskedLines[1], '第二句有效歌词')
  assert.equal(maskedLines[2], '____有效歌词')
})

test('粤语残片永远不会展示超过三行歌词', () => {
  const lines = Array.from({ length: 12 }, (_, index) => `第${index + 1}句有效歌词`)
  for (let index = 0; index < lines.length; index += 1) {
    const fragment: LyricFragment = {
      answer: `第${index + 1}句`,
      context: `____有效歌词`,
      sourceLine: lines[index],
      lineIndex: index,
    }
    const parts = lyricContextParts(lines, fragment)
    assert.ok(parts.masked.split('\n').length <= 3, `位置 ${index} 不应超过三行`)
  }
})

// 顺序返回给定值的随机函数，便于精确控制隐藏位置与片段。
// selectLyricFragment 依次调用 random()：① 选隐藏槽 ② 选片段长度 ③ 选片段起点。
function seqRandom(values: number[]) {
  let index = 0
  return () => {
    const value = values[index % values.length]
    index += 1
    return value
  }
}

const fragmentSong = (): WantListenSongCandidate => ({
  id: 'frag-target',
  title: '残片测试曲',
  releaseYear: 1998,
  language: '粤语',
  lyricist: null,
  composer: null,
  arranger: null,
  producer: null,
  lyrics: '月儿高挂天空上\n霓虹灯下人潮涌\n旧日时光轻轻淌\n街角咖啡香四溢\n晚风吻过你脸庞',
  description: null,
  story: null,
  album: { id: 'a', name: '残片专辑', releaseYear: 1998, language: '粤语', coverUrl: null },
})

function maskedLineOf(fragment: LyricFragment | null, slot: number) {
  if (!fragment) throw new Error('fragment 为 null')
  const lines = cleanLyrics(fragmentSong().lyrics)
  const parts = lyricContextParts(lines, fragment)
  return parts.masked.split('\n')[slot]
}

test('粤语残片可以隐藏上一句（隐藏区域随机落在上句）', () => {
  const lines = cleanLyrics(fragmentSong().lyrics)
  // 0 → 选第 0 槽（上一句）；0 → 片段长度 4；0.5 → 片段起点居中（部分隐藏）
  const fragment = selectLyricFragment(lines, 1, seqRandom([0, 0, 0.5]))
  assert.ok(fragment)
  assert.equal(fragment.hiddenSlot, 0)
  const maskedLines = lyricContextParts(lines, fragment).masked.split('\n')
  assert.equal(maskedLines.length, 3)
  assert.ok(maskedLines[0].includes('____'))
  assert.ok(maskedLines[0] !== '____', '上一句为部分隐藏，应保留左右歌词')
  assert.ok(!maskedLines[1].includes('____'))
  assert.ok(!maskedLines[2].includes('____'))
})

test('粤语残片可以隐藏中间一句（隐藏区域随机落在中句）', () => {
  const lines = cleanLyrics(fragmentSong().lyrics)
  // 0.5 → 选第 1 槽（中间）；0 → 片段长度 4；0.5 → 部分隐藏
  const fragment = selectLyricFragment(lines, 1, seqRandom([0.5, 0, 0.5]))
  assert.ok(fragment)
  assert.equal(fragment.hiddenSlot, 1)
  const maskedLines = lyricContextParts(lines, fragment).masked.split('\n')
  assert.equal(maskedLines.length, 3)
  assert.ok(maskedLines[1].includes('____'))
  assert.ok(maskedLines[1] !== '____', '中间句为部分隐藏，应保留左右歌词')
  assert.ok(!maskedLines[0].includes('____'))
  assert.ok(!maskedLines[2].includes('____'))
})

test('粤语残片可以隐藏下一句（隐藏区域随机落在下句）', () => {
  const lines = cleanLyrics(fragmentSong().lyrics)
  // 0.99 → 选第 2 槽（下一句）；0 → 片段长度 4；0.5 → 部分隐藏
  const fragment = selectLyricFragment(lines, 1, seqRandom([0.99, 0, 0.5]))
  assert.ok(fragment)
  assert.equal(fragment.hiddenSlot, 2)
  const maskedLines = lyricContextParts(lines, fragment).masked.split('\n')
  assert.equal(maskedLines.length, 3)
  assert.ok(maskedLines[2].includes('____'))
  assert.ok(maskedLines[2] !== '____', '下一句为部分隐藏，应保留左右歌词')
  assert.ok(!maskedLines[0].includes('____'))
  assert.ok(!maskedLines[1].includes('____'))
})

test('粤语残片支持局部歌词缺失（隐藏连续片段而非整句）', () => {
  const lines = cleanLyrics(fragmentSong().lyrics)
  // 选中间句并隐藏中间 4 字：被挖空行仍保留前后歌词，不等于整行占位。
  const fragment = selectLyricFragment(lines, 1, seqRandom([0.5, 0, 0.5]))
  assert.ok(fragment)
  const hidden = maskedLineOf(fragment, fragment.hiddenSlot ?? 1)
  assert.ok(hidden.includes('____'))
  assert.ok(hidden !== '____', '局部缺失应保留句子其余部分')
  // 答案至少含 4 个有效字（不含标点）。
  assert.ok([...fragment.answer].filter((ch) => !/[，。！？；;,.!?、:：\s]/.test(ch)).length >= 4)
})

test('粤语残片支持整句歌词隐藏（隐藏长度可达完整一句）', () => {
  const lines = cleanLyrics(fragmentSong().lyrics)
  // 0 → 选第 0 槽；0.99 → 片段长度取到上限（整句）；0 → 起点无影响
  const fragment = selectLyricFragment(lines, 1, seqRandom([0, 0.99, 0]))
  assert.ok(fragment)
  const hidden = maskedLineOf(fragment, fragment.hiddenSlot ?? 0)
  assert.equal(hidden, '____', '整句隐藏时该行应完全被占位替代')
  assert.equal(fragment.answer.replace(/[\s\p{P}\p{S}]+/gu, ''), fragment.sourceLine.replace(/[\s\p{P}\p{S}]+/gu, ''), '整句隐藏时答案为整句歌词')
})

test('防不胜防固定五个真实歌名和一个假歌名，假歌名位置由洗牌决定', () => {
  const question = buildFalseTitleQuestion(['真实一', '真实二', '真实三', '真实四', '真实五', '多余真实'], '不存在之歌', 'HARD', () => 0.41)
  assert.ok(question)
  assert.equal(question.data.options.length, 6)
  assert.equal(new Set(question.data.options.map((option) => normalizeWantListenTitle(option.label))).size, 6)
  // 反作弊：选项 key 必须是随机生成的，不能是语义化 key（fake/correct 等）
  assert.notEqual(question.correctOptionKey, 'fake')
  assert.notEqual(question.correctOptionKey, 'correct')
  assert.ok(question.data.options.every((option) => !/^(correct|wrong-\d|real-\d|fake)$/.test(option.key)))
  const correctLabel = question.data.options.find((option) => option.key === question.correctOptionKey)?.label
  assert.equal(correctLabel, '不存在之歌')
})

test('假歌名标准化会识别全角、空格、大小写和常见标点冲突', () => {
  assert.equal(normalizeWantListenTitle('  ＡＢＣ・之歌  '), normalizeWantListenTitle('abc 之歌'))
})

test('防不胜防按题号安排难度，无尽模式难度循环（15 题一轮）', () => {
  assert.equal(difficultyForQuestion(1), 'EASY')
  assert.equal(difficultyForQuestion(5), 'EASY')
  assert.equal(difficultyForQuestion(6), 'NORMAL')
  assert.equal(difficultyForQuestion(10), 'NORMAL')
  assert.equal(difficultyForQuestion(11), 'HARD')
  assert.equal(difficultyForQuestion(15), 'HARD')
  // 无尽：第 16 题回到 EASY 循环，不再固定 HARD
  assert.equal(difficultyForQuestion(16), 'EASY')
  assert.equal(difficultyForQuestion(50), 'EASY')
  assert.match(source('lib/want-listen.ts'), /fakeDifficultyOrder/)
})

test('排行榜比较遵循分数、答对数、最高连击、完成时间顺序', () => {
  const base = { score: 100, correctCount: 10, maxStreak: 5, completionTimeMs: 1000, achievedAt: new Date('2026-01-01') }
  assert.ok(compareWantListenScores({ ...base, score: 200 }, base) < 0)
  assert.ok(compareWantListenScores({ ...base, correctCount: 11 }, base) < 0)
  assert.ok(compareWantListenScores({ ...base, maxStreak: 9 }, base) < 0)
  assert.ok(compareWantListenScores({ ...base, completionTimeMs: 900 }, base) < 0)
})

test('想听协议由服务端保存提示等级、答案和最终结算，客户端没有音频入口', () => {
  const service = source('lib/want-listen.ts')
  const game = source('app/games/want-listen/WantListenGame.tsx')
  const sessionRoute = source('app/api/entertainment/want-listen/sessions/route.ts')
  assert.match(source('prisma/schema.prisma'), /hintLevel\s+Int\s+@default\(1\)/)
  assert.match(service, /current\.hintLevel/)
  assert.match(service, /scoreForWantListenAnswer\(isCorrect, nextStreak\)/)
  assert.match(service, /where: \{ id: current\.id, answeredAt: null \}/)
  assert.doesNotMatch(sessionRoute, /correctOptionKey|correctSongId|correctLyric/)
  assert.doesNotMatch(game, /new Audio\(|AudioContext|<audio\b|\.play\(/u)
})

test('Session、假歌名、统计和榜单使用独立的可索引 Prisma 结构', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260816120000_add_want_listen_game/migration.sql')
  for (const model of ['WantListenSession', 'WantListenSessionQuestion', 'WantListenStats', 'WantListenLeaderboardEntry', 'WantListenFakeTitle']) {
    assert.match(schema, new RegExp(`model ${model}`))
    assert.match(migration, new RegExp(`CREATE TABLE.*${model}`, 's'))
  }
  assert.match(schema, /@@unique\(\[userId, mode, periodType, periodKey\]\)/)
  assert.match(schema, /@@index\(\[mode, periodType, periodKey, score, correctCount, completionTimeMs\], map: "WantListenLeaderboard_mode_period_score_time_idx"\)/)
  assert.match(migration, /INDEX `WantListenLeaderboard_mode_period_score_time_idx` \(`mode`, `periodType`, `periodKey`, `score`, `correctCount`, `completionTimeMs`\)/)
})

test('四个想听成就接入现有 SPECIAL 成就同步，不创建第二套勋章系统', () => {
  const achievements = source('lib/achievements.ts')
  const service = source('lib/want-listen.ts')
  for (const title of ['此时无声胜有声', '歌词本', '真的假不了', '不用听了']) assert.match(achievements, new RegExp(title))
  assert.match(achievements, /category: 'SPECIAL'/)
  assert.match(service, /syncUserAchievements\(input\.userId, \['SPECIAL'\]\)/)
})

test('无尽模式：连续答题不结束、答错按生命规则、主动结束保存成绩', () => {
  const service = source('lib/want-listen.ts')
  const schema = source('prisma/schema.prisma')
  const config = source('lib/want-listen-config.ts')
  // 1) 不再有固定 20 题常量；questionCount 可空（null=无尽）
  assert.doesNotMatch(config, /WANT_LISTEN_TOTAL_QUESTIONS/)
  assert.match(schema, /questionCount\s+Int\?/)
  // 创建会话写入 questionCount: null（无尽）
  assert.match(service, /questionCount: null,/)
  // 结束不再依赖 20 题：无尽按「答错耗尽生命」结束
  assert.match(service, /nextWrongCount >= WANT_LISTEN_MAX_WRONG_COUNT/)
  assert.match(service, /WANT_LISTEN_MAX_WRONG_COUNT/)
  // 3) 主动结束：finishWantListenSession 保存成绩 + 更新统计/排行榜
  assert.match(service, /export async function finishWantListenSession/)
  assert.match(service, /updateWantListenStats\(database, updated, ''/)
  assert.match(service, /recordWantListenLeaderboard\(active\.id, database\)/)
  // 题目按需生成（无尽不预生成 20 题）；推进与生成在同一事务（失败回滚，不提前推进题号）
  assert.match(service, /generateNextQuestion\(database, session, nextPosition\)/)
  assert.match(service, /currentQuestion: \{ increment: 1 \},/)
  assert.match(service, /buildQuestionAtPosition/)
  // 粤语残片仍保留脏题二次过滤
  assert.match(service, /repairCantoneseSessionQuestions/)
  assert.match(service, /positionsToReplace/)
  assert.match(service, /loadSessionRaw\(userId, sessionId\)/)
})

test('无尽模式：三个模式统一生效，连击/生命/总答题数字段存在', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260819180000_want_listen_endless_mode/migration.sql')
  const config = source('lib/want-listen-config.ts')
  for (const field of ['totalQuestions', 'currentStreak', 'maxStreak', 'wrongCount', 'livesRemaining']) {
    assert.match(schema, new RegExp(`${field}\\s+Int`))
    assert.match(migration, new RegExp('ADD COLUMN `' + field + '`'))
  }
  assert.match(migration, /MODIFY COLUMN `questionCount` INT NULL/)
  // 排行榜字段与排序（无尽最佳成绩）
  assert.match(schema, /maxStreak\s+Int\s+@default\(0\)/)
  assert.match(schema, /WantListenLeaderboard_endless_sort_idx/)
  assert.match(migration, /UPDATE `WantListenLeaderboardEntry` SET `totalQuestions` = 20/)
  // 三个模式常量统一
  assert.match(config, /WANT_LISTEN_MODES = \['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE'\]/)
})

test('顶部控制：左侧退出 / 右侧暂停（复用听听浮动控制，浅色主题适配），业务逻辑不动', () => {
  const game = source('app/games/want-listen/WantListenGame.tsx')
  const css = source('app/globals.css')
  // 1) 顶部浮动按钮：退出在左、暂停在右，小尺寸边框低存在感
  assert.match(game, /want-listen-game-exit-button/)
  assert.match(game, /want-listen-game-pause-button/)
  assert.match(css, /\.want-listen-game-exit-button \{[^}]*left:max\(16px,env\(safe-area-inset-left\)\)/)
  assert.match(css, /\.want-listen-game-pause-button \{[^}]*right:max\(16px,env\(safe-area-inset-right\)\)/)
  assert.match(css, /\.want-listen-game-exit-button,.want-listen-game-pause-button \{[^}]*border:1px solid var\(--border\)[^}]*font-size:11px/)
  // 2) 暂停：点击遮罩游戏区域，显示继续挑战 / 结束挑战 / 退出游戏
  assert.match(game, /want-listen-pause-backdrop/)
  assert.match(game, /游戏已暂停/)
  assert.match(game, /继续挑战/)
  assert.match(game, /setPaused\(false\)/)
  assert.match(css, /\.want-listen-pause-backdrop \{[^}]*position:fixed/)
  // 3) 退出确认文案统一
  assert.match(game, /确定退出本次挑战吗？/)
  assert.match(game, /退出后本次挑战进度不会保存。/)
  // 4) 不修改业务逻辑：答题/下一题/结束挑战 API 均保留，未新增暂停 API
  assert.match(game, /\/answer/)
  assert.match(game, /\/next/)
  assert.match(game, /\/finish/)
  assert.match(game, /\/abandon/)
  assert.doesNotMatch(game, /\/pause/)
  // 5) 移动端适配
  assert.match(css, /\.want-listen-game-exit-button,.want-listen-game-pause-button \{[^}]*top:max\(10px,env\(safe-area-inset-top\)\)[^}]*min-height:40px/)
})

test('防不胜防进入新题会重置揭晓状态，未答题不泄露答案', () => {
  const game = source('app/games/want-listen/WantListenGame.tsx')
  const service = source('lib/want-listen.ts')
  // 客户端：题目 id 变化即重置 reveal 守卫，作答成功后才显示答案与高亮，
  // 上一题的作答/反馈/选项颜色绝不残留到下一题（杜绝答案闪现）。
  assert.match(game, /const \[revealed, setRevealed\] = useState\(false\)/)
  assert.match(game, /setRevealed\(Boolean\(session\?\.question\?\.result\)\)\s*\}, \[session\?\.question\?\.id(?:\s*,\s*session\?\.question\?\.result)?\]\)/)
  assert.match(game, /setRevealed\(true\)/)
  assert.match(game, /revealed && result \? <div className={`want-listen-answer-result/)
  // 服务端：未答题的 question 不携带 correctOptionKey / correctAnswer，
  // 仅在已作答（answeredAt）时随 result 一并返回正确答案。
  assert.match(service, /const answered = Boolean\(question\.answeredAt\)/)
  assert.match(service, /const result = answered\s*\?/)
  assert.doesNotMatch(service, /correctOptionKey: question\.correctOptionKey,\s*\n\s*options:/)
})

test('错误日志：服务端记录 operation / userId / mode / device / stack，数据库迁移失配返回明确 code', () => {
  const api = source('lib/want-listen-api.ts')
  const sessionsRoute = source('app/api/entertainment/want-listen/sessions/route.ts')
  const summaryRoute = source('app/api/entertainment/want-listen/summary/route.ts')
  // 1) 结构化日志：operation + userId + mode + device + stack
  assert.match(api, /handleWantListenError\(error: unknown, operation: string, context/)
  assert.match(api, /const logContext = \{\s+operation,/)
  assert.match(api, /userId: context\.userId/)
  assert.match(api, /mode: context\.mode/)
  assert.match(api, /device,\s+ip: context\.ip/)
  assert.match(api, /stack\s*\?/)
  assert.match(api, /console\.error\(`\[want-listen\.\$\{operation\}\]`, JSON\.stringify\(logContext\)\)/)
  // 2) device 检测：iOS / Android / 桌面
  assert.match(api, /MOBILE_IOS/)
  assert.match(api, /MOBILE_ANDROID/)
  assert.match(api, /return 'DESKTOP'/)
  // 3) 数据库迁移失配（P2010/P2011/P2021 → Unknown column/table）识别
  assert.match(api, /P2010/)
  assert.match(api, /P2011/)
  assert.match(api, /P2021/)
  assert.match(api, /DATABASE_MIGRATION_OUT_OF_SYNC/)
  // 4) 业务异常仍返回原文案与状态码，未知异常保持友好提示（生产不泄露堆栈）
  assert.match(api, /isServiceError = error instanceof WantListenServiceError/)
  assert.match(api, /WantListenServiceError'/)
  assert.match(api, /\(error as WantListenServiceError\)\.message, \(error as WantListenServiceError\)\.status, \(error as WantListenServiceError\)\.code/)
  assert.match(api, /想听服务暂时不可用，请稍后再试。/)
  // 5) 路由：POST 全链路 try/catch，创建会话时记录 userId/mode/ip/userAgent/device 上下文
  assert.match(sessionsRoute, /let userId: string \| undefined/)
  assert.match(sessionsRoute, /let mode: unknown/)
  assert.match(sessionsRoute, /handleWantListenError\(error, 'sessions\.create', \{ operation: 'sessions\.create', userId, mode, ip, userAgent \}\)/)
  assert.match(sessionsRoute, /createWantListenSession\(guard\.user\.id, mode,/)
  // 6) summary 路由同样带上 userId 上下文
  assert.match(summaryRoute, /handleWantListenError\(error, 'summary', \{ operation: 'summary', userId: guard\.user\.id \}\)/)
})

test('session 生命周期：同用户同模式仅保留一个有效 IN_PROGRESS，旧残留标记 ABANDONED 不删除', () => {
  const service = source('lib/want-listen.ts')
  // 1) create 前：过期进行中 → EXPIRED
  assert.match(service, /updateMany\(\{ where: \{ userId, mode, status: 'IN_PROGRESS', expiresAt: \{ lte: now \} \}, data: \{ status: 'EXPIRED', activeKey: null \} \}\)/)
  // 2) 同模式多个进行中：保留最新一次，其余 → ABANDONED（不删除数据）
  assert.match(service, /const activeSessions = await prisma\.wantListenSession\.findMany\(\{ where: \{ userId, mode, status: 'IN_PROGRESS' \}, orderBy: \{ createdAt: 'desc' \}/)
  assert.match(service, /activeSessions\.slice\(1\)\.map\(\(session\) => session\.id\)/)
  assert.match(service, /status: 'ABANDONED', activeKey: null/)
  // 3) 已有唯一有效进行中会话 → 返回其 sessionId（继续游戏），不重复创建
  assert.match(service, /const existing = activeSessions\[0\]/)
  assert.match(service, /return \{ resumed: true, session: toPublicState\(restored\) \}/)
})

test('首页状态：summary 过滤过期进行中会话，每模式仅返回最新一个（前端据此显示继续游戏）', () => {
  const service = source('lib/want-listen.ts')
  const home = source('app/games/want-listen/WantListenHome.tsx')
  // 1) summary 先过期清理 + 只查未过期进行中
  assert.match(service, /status: 'IN_PROGRESS', expiresAt: \{ gt: now \}/)
  // 2) 每模式仅保留最新一个（Map 去重）
  assert.match(service, /latestActiveByMode = new Map<string, \(typeof active\)\[number\]>\(\)/)
  assert.match(service, /if \(!latestActiveByMode\.has\(session\.mode\)\) latestActiveByMode\.set\(session\.mode, session\)/)
  assert.match(service, /activeSessions: Array\.from\(latestActiveByMode\.values\(\)\)/)
  // 3) 前端：存在进行中会话 → 按钮显示「继续第 X 题」（而非开始游戏）
  assert.match(home, /active \? `继续第 \$\{active\.currentQuestion\} 题`/)
})

test('历史残留清理脚本：过期→EXPIRED、每用户每模式保留最新、其余→ABANDONED、不删除数据', () => {
  const script = source('scripts/cleanup-want-listen-stale-sessions.ts')
  assert.match(script, /status: 'IN_PROGRESS', expiresAt: \{ lte: now \}/)
  assert.match(script, /status: 'EXPIRED', activeKey: null/)
  assert.match(script, /groupKey = `\$\{row\.userId\}:\$\{row\.mode\}`/)
  assert.match(script, /status: 'ABANDONED', activeKey: null/)
  assert.doesNotMatch(script, /deleteMany/)
})

// ---------- 长时间游戏：滑动过期 / 原子推进 / 缺失恢复 / 前端自动恢复 ----------

test('滑动过期：真实活跃行为刷新 expiresAt，仅前移不回拨', () => {
  const service = source('lib/want-listen.ts')
  const config = source('lib/want-listen-config.ts')
  // TTL 是「不活动窗口」而非固定总时长上限
  assert.match(config, /滑动过期/)
  assert.match(config, /WANT_LISTEN_SESSION_TTL_MS = 2 \* 60 \* 60 \* 1000/)
  // refreshWantListenExpiry：只对 expiresAt <= now+TTL 的进行中会话前移
  assert.match(service, /async function refreshWantListenExpiry\(userId: string, sessionId: string, now = new Date\(\)\)/)
  assert.match(service, /expiresAt: \{ lte: nextExpiry \}/)
  // 各活跃行为刷新：读状态 / 答题 / 下一题 / 恢复会话
  assert.match(service, /await refreshWantListenExpiry\(userId, sessionId\)/)
  assert.match(service, /await refreshWantListenExpiry\(userId, existing\.id, now\)/)
  assert.match(service, /expiresAt: new Date\(Date\.now\(\) \+ WANT_LISTEN_SESSION_TTL_MS\)/)
  assert.match(service, /currentQuestion: \{ increment: 1 \},[\s\S]{0,80}expiresAt: new Date\(Date\.now\(\) \+ WANT_LISTEN_SESSION_TTL_MS\)/)
})

test('下一题原子推进：题目生成失败时 currentQuestion 不会提前推进', () => {
  const service = source('lib/want-listen.ts')
  // 推进 + 生成在同一事务（transactionWithRetry）
  assert.match(service, /const advanced = await transactionWithRetry\(async \(database\) => \{/)
  assert.match(service, /if \(updated\.count !== 1\) return false/)
  assert.match(service, /await generateNextQuestion\(database, session, nextPosition\)/)
  assert.match(service, /if \(!advanced\) return getWantListenSessionState/)
})

test('当前题缺失自动恢复：IN_PROGRESS 且题目缺失时重建，不改变分数/连击/题号', () => {
  const service = source('lib/want-listen.ts')
  assert.match(service, /async function ensureCurrentQuestionExists\(session: SessionWithQuestions/)
  assert.match(service, /const hasCurrent = session\.WantListenSessionQuestion\.some\(\(question\) => question\.position === session\.currentQuestion\)/)
  assert.match(service, /await generateNextQuestion\(prisma, session, session\.currentQuestion\)/)
  // 读状态 / 提示前自动恢复
  assert.match(service, /session = await ensureCurrentQuestionExists\(session\)/)
  // 不改变分数/连击：重建逻辑只写题目记录
  assert.doesNotMatch(service, /ensureCurrentQuestionExists[\s\S]{0,200}score: \{ increment/)
})

test('前端错误区分：401 才提示重新认证，500/网络自动重试恢复，不结束对局', () => {
  const game = source('app/games/want-listen/WantListenGame.tsx')
  // 指数退避重试
  assert.match(game, /const RETRY_DELAYS = \[500, 1000, 2000\]/)
  assert.match(game, /NETWORK_ERROR/)
  // 401 / AUTH_REQUIRED / AUTH_SESSION_EXPIRED → 重新认证（保留游戏状态）
  assert.match(game, /response\.status === 401 \|\| code === 'AUTH_REQUIRED' \|\| code === 'AUTH_SESSION_EXPIRED'/)
  assert.match(game, /'AUTH_REQUIRED', response\.status\)/)
  // 5xx / 429 自动重试
  assert.match(game, /response\.status >= 500 \|\| response\.status === 429/)
  // 恢复函数：重新获取 Session，不清空对局
  assert.match(game, /async function recoverSession\(\)/)
  assert.match(game, /setSession\(data\)/)
  // 当前题缺失 → 自动恢复页（不强制重新开始）
  assert.match(game, /正在恢复当前题目…/)
  assert.doesNotMatch(game, /当前题目不可用，请重新开始。/)
  // 到期后先向服务端确认，不本地直接判过期
  assert.match(game, /滑动续期可能已刷新，不能本地直接判过期/)
})

test('API-only 活跃：middleware matcher 覆盖想听 API，rolling session 在 API 请求上生效', () => {
  const middleware = source('middleware.ts')
  // matcher 覆盖所有非静态路径（含 /api/...）
  assert.match(middleware, /matcher: \['\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\|robots\.txt\|manifest\.webmanifest\).*\)'\]/)
  // 想听 API 路径不在此 public 前缀列表（/api/auth/ 等）→ 会走验证 + 滚动续期
  assert.match(middleware, /'\/api\/auth\/',/)
  assert.doesNotMatch(middleware, /\/api\/entertainment\//)
  // 滚动续期逻辑：剩余 < 15 天时重签（对页面与 API 请求统一生效）
  assert.match(middleware, /needsRollingRenew/)
  assert.match(middleware, /renewSessionCookie/)
  assert.match(middleware, /response\.cookies\.set\(authCookieName, cookie\.token, cookie\.options\)/)
})

test('过期宽限窗口：expiresAt 刚过在宽限内仍可恢复，超过宽限才 EXPIRED', () => {
  const service = source('lib/want-listen.ts')
  const config = source('lib/want-listen-config.ts')
  assert.match(config, /WANT_LISTEN_EXPIRY_GRACE_MS = 10 \* 60 \* 1000/)
  // expireSessionIfNeeded：仅 expiresAt <= now - GRACE 判定 EXPIRED
  assert.match(service, /expiresAt: \{ lte: new Date\(now\.getTime\(\) - WANT_LISTEN_EXPIRY_GRACE_MS\) \}/)
  // ensureCurrentQuestionExists：超过宽限才不恢复（刚过期仍可重建当前题）
  assert.match(service, /session\.expiresAt\.getTime\(\) <= now\.getTime\(\) - WANT_LISTEN_EXPIRY_GRACE_MS/)
  // 场景 A：expiresAt 未来 10 分钟且题目缺失 → 恢复（hasCurrent 判断后重建）
  assert.match(service, /const hasCurrent = session\.WantListenSessionQuestion\.some/)
  // 场景 B：刚过 TTL（宽限内）→ 仍 IN_PROGRESS，下次操作 refreshWantListenExpiry 续期
  assert.match(service, /expiresAt: \{ lte: nextExpiry \}/)
})

test('长局恢复：200 题 / 27000 分 / 连击 80 场景下 score/streak/correctCount 不变化、不重建对局', () => {
  const service = source('lib/want-listen.ts')
  // ensureCurrentQuestionExists 重建题目时不触碰会话成绩字段
  const recoveryBlock = service.match(/async function ensureCurrentQuestionExists[\s\S]*?^\}/m)?.[0] || ''
  assert.ok(recoveryBlock, 'ensureCurrentQuestionExists 应存在')
  assert.doesNotMatch(recoveryBlock, /score:/, '恢复逻辑不应改写 score')
  assert.doesNotMatch(recoveryBlock, /correctCount:/, '恢复逻辑不应改写 correctCount')
  assert.doesNotMatch(recoveryBlock, /currentStreak:/, '恢复逻辑不应改写 streak')
  assert.doesNotMatch(recoveryBlock, /currentQuestion: \{ increment/, '恢复逻辑不应推进题号')
  assert.doesNotMatch(recoveryBlock, /status: 'COMPLETED'/, '恢复逻辑不应结束对局')
  // 长局持续活跃：answer/next 刷新 expiresAt（滑动续期），不要求重新登录
  assert.match(service, /expiresAt: new Date\(Date\.now\(\) \+ WANT_LISTEN_SESSION_TTL_MS\)/)
  // 连续答题不重建对局：createWantListenSession resume 分支
  assert.match(service, /await refreshWantListenExpiry\(userId, existing\.id, now\)/)
})
