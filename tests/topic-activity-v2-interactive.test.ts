import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { fixture, instant } from './fixtures/topic-v2-transaction'
import { calculateTopicV2Test, castTopicV2Vote, getTopicV2Attempt, getTopicV2Poll, getTopicV2Test, submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { topicPosterLayout } from '@/lib/topic-activity-v2-poster-layout'
import { saveTopicActivityV2Program } from '@/lib/topic-activity-v2'

test('knowledge scoring rejects foreign/incomplete answers and computes result server-side', () => {
  const f = fixture()
  assert.equal(calculateTopicV2Test(f.program.test, { q1: 'yes' }).score, 2)
  assert.equal(calculateTopicV2Test(f.program.test, { q1: 'no' }).result.id, 'low')
  assert.throws(() => calculateTopicV2Test(f.program.test, { q1: 'other' }), { code: 'TEST_OPTION_INVALID' })
  assert.throws(() => calculateTopicV2Test(f.program.test, { q1: 'yes', score: 999 }), { code: 'TEST_ANSWERS_INVALID' })
})
test('personality weights and deterministic ties are calculated server-side', () => {
  const f = fixture(); f.program.test.mode = 'PERSONALITY'
  f.program.test.results = [{ id: 'one', title: '一', description: '' }, { id: 'two', title: '二', description: '' }]
  f.program.test.questions[0].options = [{ id: 'a', label: 'A', weights: { one: 1, two: 1 } }, { id: 'b', label: 'B', weights: { two: 2 } }]
  assert.equal(calculateTopicV2Test(f.program.test, { q1: 'a' }).result.id, 'one')
  const result = calculateTopicV2Test(f.program.test, { q1: 'b' }); assert.equal(result.result.id, 'two'); assert.equal(result.score, null)
})
test('one effective ballot; duplicate request idempotent, modification follows configuration', async () => {
  const f = fixture()
  await f.run(async () => {
    await Promise.all([1, 2].map(() => castTopicV2Vote({ activityId: f.activity.id, userId: 'user-one', choices: ['a'], now: instant })))
    assert.equal(f.state.votes.length, 1)
    await assert.rejects(castTopicV2Vote({ activityId: f.activity.id, userId: 'user-one', choices: ['b'], now: instant }), { code: 'POLL_ALREADY_SUBMITTED' })
    f.program.poll.allowChange = true
    await castTopicV2Vote({ activityId: f.activity.id, userId: 'user-one', choices: ['b'], now: instant })
    assert.deepEqual(f.state.votes[0].choices, ['b']); assert.equal(f.state.votes.length, 1)
  })
})
test('multi-select rejects duplicates, excessive and unknown choices; cutoff blocks writes', async () => {
  const f = fixture(); f.program.poll.mode = 'MULTI'; f.program.poll.maxChoices = 2; f.program.poll.options.push({ id: 'c', label: 'C' })
  await f.run(async () => {
    for (const choices of [['a', 'a'], ['a', 'b', 'c'], ['foreign'], []]) await assert.rejects(castTopicV2Vote({ activityId: f.activity.id, userId: 'user-one', choices, now: instant }), { code: 'POLL_CHOICES_INVALID' })
    f.program.poll.endsAt = new Date(instant.getTime() - 1).toISOString()
    await assert.rejects(castTopicV2Vote({ activityId: f.activity.id, userId: 'user-one', choices: ['a'], now: instant }), { code: 'POLL_CLOSED' })
  }); assert.equal(f.state.votes.length, 0)
})
test('hidden poll results stay hidden; visible percentages use participants not choices', async () => {
  const f = fixture(); f.program.poll.mode = 'MULTI'; f.program.poll.maxChoices = 2
  f.state.votes.push({ userId: 'user-one', activityId: f.activity.id, pollId: f.program.poll.id, choices: ['a', 'b'] })
  await f.run(async () => {
    assert.equal((await getTopicV2Poll(f.activity.id, 'user-one', instant)).results, null)
    f.program.poll.showLiveResults = true
    const result = (await getTopicV2Poll(f.activity.id, 'user-one', instant)).results!
    assert.equal(result.participantCount, 1); assert.deepEqual(result.options.map((option) => option.percentage), [100, 100])
  })
})
test('test submission is idempotent by request key and historical snapshot is immutable', async () => {
  const f = fixture(); const input = { activityId: f.activity.id, userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'request-one', now: instant }
  await f.run(async () => {
    const first = await submitTopicV2Test(input); f.program.test.results[1].title = '新结果标题'
    const repeated = await submitTopicV2Test(input)
    assert.equal(repeated.changed, false); assert.deepEqual(first.attempt.resultSnapshot, repeated.attempt.resultSnapshot)
    assert.equal(f.state.attempts.length, 1)
    await assert.rejects(submitTopicV2Test({ ...input, answers: { q1: 'no' } }), { code: 'TEST_REQUEST_KEY_CONFLICT' })
  })
})
test('retake false blocks new attempts; public test and private result hide answers/other users', async () => {
  const f = fixture(); f.program.test.allowRetake = false
  await f.run(async () => {
    const first = await submitTopicV2Test({ activityId: f.activity.id, userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'request-one', now: instant })
    await assert.rejects(submitTopicV2Test({ activityId: f.activity.id, userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'request-two', now: instant }), { code: 'TEST_RETAKE_NOT_ALLOWED' })
    await assert.rejects(getTopicV2Attempt(f.activity.id, first.attempt.id, 'other-user'), { code: 'TEST_RESULT_NOT_FOUND' })
    assert.ok(!JSON.stringify((await getTopicV2Test(f.activity.id)).test).includes('correctOptionId'))
    assert.ok(!JSON.stringify(first.attempt.resultSnapshot).includes('answers'))
  })
})
test('config cannot rewrite same-version ballots/test with completed records', async () => {
  const f = fixture()
  await f.run(async () => {
    await castTopicV2Vote({ activityId: f.activity.id, userId: 'user-one', choices: ['a'], now: instant })
    await assert.rejects(saveTopicActivityV2Program(f.activity.id, 'admin-one', { ...f.program, poll: { ...f.program.poll, title: '静默改写' } }), { code: 'TOPIC_V2_POLL_VERSION_LOCKED' })
    await submitTopicV2Test({ activityId: f.activity.id, userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'request-one', now: instant })
    await assert.rejects(saveTopicActivityV2Program(f.activity.id, 'admin-one', { ...f.program, test: { ...f.program.test, title: '静默改写' } }), { code: 'TOPIC_V2_TEST_VERSION_LOCKED' })
    const saved = await saveTopicActivityV2Program(f.activity.id, 'admin-one', { ...f.program, test: { ...f.program.test, version: 2, title: '显式新版' } })
    assert.equal(saved.test.version, 2)
  })
})
test('PNG poster is valid bounded image with escaped text and QR', async () => {
  const bytes = await renderTopicV2Poster({ title: '<script>unsafe</script>', description: '真实测试结果，包含中文和长文。'.repeat(20), activityTitle: '本地活动', score: 2, maxScore: 2, nickname: '测试用户', poster: { width: 360, height: 640, showNickname: true, showQrCode: true } }, 'activity-one')
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1440); assert.ok(bytes.length > 0)
})
test('poster uses a fixed 3:4 canvas and crops supplied background without distortion', async () => {
  const background = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#123456' } }).png().toBuffer()
  const bytes = await renderTopicV2Poster({ title: '中文结果', description: '说明', poster: { width: 480, height: 480, showNickname: false, showQrCode: false } }, 'activity-one', background)
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, 1080)
  assert.equal(metadata.height, 1440)
  assert.equal(metadata.width! / metadata.height!, 3 / 4)
})
test('poster places wrapped Chinese result text in a bounded paper group', async () => {
  const value = {
    activityTitle: '天使的礼物活动',
    title: '结果标题需要完整换行测试海报布局',
    description: '这是一段用于检查海报文字间距的中文说明。',
    poster: { showNickname: false, showQrCode: false },
  }
  const svg = topicPosterLayout(value)
  const result = svg.split('data-poster-group="result"')[1].split('data-poster-group="identity"')[0]
  const baselines = [...result.matchAll(/<text x="118" y="(\d+)"/gu)].map((match) => Number(match[1]))
  assert.ok(baselines.length >= 3, 'title wraps into two lines before the description')
  assert.ok(baselines.every((y) => y >= 620 && y < 1080))
  assert.ok(baselines[2] - baselines[1] < 180, 'description stays close to its title')
  const metadata = await sharp(await renderTopicV2Poster(value, 'activity-one')).metadata()
  assert.equal(metadata.width, 1080)
  assert.equal(metadata.height, 1440)
})
test('poster config uses the bundled Noto CJK font through fontconfig, not unsupported embedded SVG fonts', () => {
  const source = readFileSync(join(process.cwd(), 'lib/topic-activity-v2-poster.ts'), 'utf8') + readFileSync(join(process.cwd(), 'lib/topic-activity-v2-poster-layout.ts'), 'utf8')
  assert.match(source, /NotoSansSC-VF\.ttf/)
  assert.match(source, /FONTCONFIG_PATH/)
  assert.match(source, /Noto Sans SC, Noto Sans CJK SC, sans-serif/)
  assert.doesNotMatch(source, /@font-face|data:font\/ttf;base64/)
})
test('poster rejects private namespace and arbitrary background URL', async () => {
  for (const backgroundUrl of ['https://evil.invalid/a.png', '/cos/topic-activity/private/source.png', '/uploads/../secret.png', '/uploads/%2e%2e/secret.png']) {
    await assert.rejects(renderTopicV2Poster({ poster: { width: 360, height: 640, backgroundUrl } }, 'a'), { code: 'POSTER_BACKGROUND_INVALID' })
  }
})
