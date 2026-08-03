import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getFallbackWaveTarget,
  hasUsableFrequencyData,
} from '../components/music/cassette/RecorderWaveform'

const read = (path: string) => readFileSync(path, 'utf8')

test('频谱有有效数据时保持 real 分析模式', () => {
  const waveform = read('components/music/cassette/RecorderWaveform.tsx')
  assert.equal(hasUsableFrequencyData(new Uint8Array([0, 0, 0])), false)
  assert.equal(hasUsableFrequencyData(new Uint8Array([0, 1, 3, 0])), true)
  assert.match(waveform, /setAnalysisMode\('real'\)/)
  assert.match(waveform, /analyser\.getByteFrequencyData\(data\)/)
})

test('连续全零频谱会进入 fallback，而不是停在固定基线', () => {
  const waveform = read('components/music/cassette/RecorderWaveform.tsx')
  assert.match(waveform, /ZERO_DATA_FRAME_THRESHOLD = 20/)
  assert.match(waveform, /zeroFrames >= ZERO_DATA_FRAME_THRESHOLD/)
  assert.match(waveform, /setAnalysisMode\('fallback', \{ analyserAllZero: true \}\)/)
  assert.match(waveform, /drawFallbackVisualization\(time\)/)
})

test('fallback 声纹由连续确定性波形驱动，并为中间柱保留更高权重', () => {
  const waveform = read('components/music/cassette/RecorderWaveform.tsx')
  const first = getFallbackWaveTarget(5, 1_000)
  const sameFrame = getFallbackWaveTarget(5, 1_000)
  const later = getFallbackWaveTarget(5, 1_200)
  assert.equal(first, sameFrame)
  assert.notEqual(first, later)
  assert.match(waveform, /Math\.sin\(time \* 4\.2/)
  assert.match(waveform, /Math\.sin\(time \* 2\.45/)
  assert.match(waveform, /centerWeight/)
  assert.doesNotMatch(waveform, /Math\.random\(\)/)
  assert.doesNotMatch(waveform, /setInterval\(/)
})

test('暂停、结束和不可见状态会停止高幅动画并回落到基线', () => {
  const waveform = read('components/music/cassette/RecorderWaveform.tsx')
  assert.match(waveform, /const audioIsPlaying = Boolean\(audio && playing && !audio\.paused && !audio\.ended\)/)
  assert.match(waveform, /setAnalysisMode\('idle'\)/)
  assert.match(waveform, /const settleBaseline = \(\) =>/)
  assert.match(waveform, /scheduleBaseline\(\)/)
  assert.match(waveform, /document\.addEventListener\('visibilitychange'/)
})

test('切歌和卸载时只保留一个 RAF 生命周期并清理监听器', () => {
  const waveform = read('components/music/cassette/RecorderWaveform.tsx')
  const provider = read('components/music/MusicPlayerProvider.tsx')
  assert.match(waveform, /window\.cancelAnimationFrame\(frame\)/)
  assert.match(waveform, /active = false/)
  assert.match(waveform, /motionQuery\.removeEventListener\('change'/)
  assert.match(waveform, /document\.removeEventListener\('visibilitychange'/)
  assert.equal((provider.match(/new Audio\(\)/g) || []).length, 1)
})

test('声纹分析失败时降级，不会包住或取消 audio.play()', () => {
  const waveform = read('components/music/cassette/RecorderWaveform.tsx')
  const provider = read('components/music/MusicPlayerProvider.tsx')
  assert.match(waveform, /catch \{[\s\S]*setAnalysisMode\('fallback'\)[\s\S]*drawFallbackVisualization/)
  assert.match(provider, /audio\.src = nextTrack\.previewUrl/)
  assert.match(provider, /audio\.load\(\)/)
  assert.match(provider, /await audio\.play\(\)/)
  assert.match(provider, /audio\.crossOrigin = 'anonymous'/)
  assert.match(provider, /if \(sameOrigin\)[\s\S]*audio\.crossOrigin = 'anonymous'[\s\S]*else \{[\s\S]*audio\.removeAttribute\('crossorigin'\)/)
})
