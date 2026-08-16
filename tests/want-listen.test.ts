import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCantoneseFragmentQuestion,
  buildFalseTitleQuestion,
  buildWantListenQuestion,
  type WantListenSongCandidate,
} from '../lib/want-listen-questions'
import { cleanLyrics, selectLyricFragment, selectSafeLyricSnippet } from '../lib/want-listen-lyrics'
import { difficultyForQuestion, scoreForWantListenAnswer } from '../lib/want-listen-config'
import { compareWantListenScores } from '../lib/want-listen-period'
import { normalizeWantListenTitle } from '../lib/want-listen-title'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
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
    album: { id: `album-${id}`, name: `专辑 ${id}`, releaseYear, language, coverUrl: null },
  }
}

test('想听的歌曲题有四个唯一真实歌名选项，并提供四层提示资料', () => {
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
  assert.equal(question.data.hints?.length, 4)
  assert.deepEqual(scoreForWantListenAnswer('WANT_LISTEN', 1), 400)
  assert.deepEqual(scoreForWantListenAnswer('WANT_LISTEN', 2), 300)
  assert.deepEqual(scoreForWantListenAnswer('WANT_LISTEN', 3), 200)
  assert.deepEqual(scoreForWantListenAnswer('WANT_LISTEN', 4), 100)
})

test('歌词清洗会移除 LRC 时间轴、metadata、署名和无意义语气词', () => {
  const lines = cleanLyrics('[ar:陈奕迅]\n[00:12.30]啊\n[00:15.00]谁都只得那双手\n作词：黄伟文\n\n靠拥抱亦难任你拥有')
  assert.deepEqual(lines, ['谁都只得那双手', '靠拥抱亦难任你拥有'])
  assert.equal(selectSafeLyricSnippet(lines, '不存在的歌名'), '靠拥抱亦难任你拥有')
})

test('粤语残片使用连续自然片段，四个歌词选项唯一', () => {
  const target = song('target', '粤语目标', '谁都只得那双手\n靠拥抱亦难任你拥有')
  const pool = [
    target,
    song('other-1', '粤语一', '明明相隔很远\n仍然记得你的声音'),
    song('other-2', '粤语二', '如果这都不算爱\n还有什么值得等'),
    song('other-3', '粤语三', '沿途风光都很好\n只是少了你的拥抱'),
  ]
  const question = buildCantoneseFragmentQuestion(target, pool, 1, () => 0.27)
  assert.ok(question)
  assert.equal(question.data.options.length, 4)
  assert.equal(new Set(question.data.options.map((option) => normalizeWantListenTitle(option.label))).size, 4)
  assert.match(question.data.maskedContext || '', /____/u)
  assert.ok(question.data.completeContext)
  assert.ok(question.data.correctLyric)
  assert.equal(selectLyricFragment(cleanLyrics(target.lyrics), 1)?.context.includes('____'), true)
})

test('防不胜防固定五个真实歌名和一个假歌名，假歌名位置由洗牌决定', () => {
  const question = buildFalseTitleQuestion(['真实一', '真实二', '真实三', '真实四', '真实五', '多余真实'], '不存在之歌', 'HARD', () => 0.41)
  assert.ok(question)
  assert.equal(question.data.options.length, 6)
  assert.equal(new Set(question.data.options.map((option) => normalizeWantListenTitle(option.label))).size, 6)
  assert.equal(question.correctOptionKey, 'fake')
  assert.equal(question.data.options.filter((option) => option.key === 'fake').length, 1)
})

test('假歌名标准化会识别全角、空格、大小写和常见标点冲突', () => {
  assert.equal(normalizeWantListenTitle('  ＡＢＣ・之歌  '), normalizeWantListenTitle('abc 之歌'))
})

test('防不胜防按题号安排难度，题库不足时服务端可按相邻难度回退', () => {
  assert.equal(difficultyForQuestion(1), 'EASY')
  assert.equal(difficultyForQuestion(5), 'EASY')
  assert.equal(difficultyForQuestion(6), 'NORMAL')
  assert.equal(difficultyForQuestion(15), 'NORMAL')
  assert.equal(difficultyForQuestion(16), 'HARD')
  assert.equal(difficultyForQuestion(20), 'HARD')
  assert.match(source('lib/want-listen.ts'), /fakeDifficultyOrder/)
})

test('排行榜比较遵循分数、答对数、完成时间顺序', () => {
  const base = { score: 100, correctCount: 10, completionTimeMs: 1000, achievedAt: new Date('2026-01-01') }
  assert.ok(compareWantListenScores({ ...base, score: 200 }, base) < 0)
  assert.ok(compareWantListenScores({ ...base, correctCount: 11 }, base) < 0)
  assert.ok(compareWantListenScores({ ...base, completionTimeMs: 900 }, base) < 0)
})

test('想听协议由服务端保存提示等级、答案和最终结算，客户端没有音频入口', () => {
  const service = source('lib/want-listen.ts')
  const game = source('app/games/want-listen/WantListenGame.tsx')
  const sessionRoute = source('app/api/entertainment/want-listen/sessions/route.ts')
  assert.match(source('prisma/schema.prisma'), /hintLevel\s+Int\s+@default\(1\)/)
  assert.match(service, /current\.hintLevel/)
  assert.match(service, /scoreForWantListenAnswer\(session\.mode, current\.hintLevel\)/)
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
  assert.match(schema, /@@index\(\[mode, periodType, periodKey, score, correctCount, completionTimeMs\]\)/)
})

test('四个想听成就接入现有 SPECIAL 成就同步，不创建第二套勋章系统', () => {
  const achievements = source('lib/achievements.ts')
  const service = source('lib/want-listen.ts')
  for (const title of ['此时无声胜有声', '歌词本', '真的假不了', '不用听了']) assert.match(achievements, new RegExp(title))
  assert.match(achievements, /category: 'SPECIAL'/)
  assert.match(service, /syncUserAchievements\(input\.userId, \['SPECIAL'\]\)/)
})
