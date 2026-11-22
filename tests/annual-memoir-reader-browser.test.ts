import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { chromium } from 'playwright'
import sharp from 'sharp'

test('desktop and mobile-width readers navigate ten chapters and download the archive', {
  skip: !process.env.MEMOIR_BROWSER_PATH && process.env.MEMOIR_BROWSER_QA !== '1',
}, async () => {
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>
  }
  const bundle = await esbuild.build({
    stdin: {
      loader: 'tsx', resolveDir: process.cwd(), contents: `
        import { createRoot } from 'react-dom/client'
        import { MemoirReader } from './app/activities/[activityId]/annual-memoir/MemoirReader'
        createRoot(document.getElementById('root')).render(<MemoirReader activityId="fixture-activity" year={2026}
          canGenerate={false} initialReport={{ nickname: '想把故事留在葡萄树下的长昵称合成测试用户', uid: 747272, registered: '2026-01-01',
            firstRecordedDay: null, activeDays: 987654321, checkIns: 8, checkInExperience: 20, posts: 3,
            replies: 6, likesGiven: 20, likesReceived: 9, friends: 2, followers: 3, games: 2,
            bestScore: 8, badges: 1, topics: 2, verified: 1, title: '故事记录者', message: '年度寄语' }} />)
      `,
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': process.cwd(), 'next/link': './tests/fixtures/memoir-browser-link.tsx' },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ executablePath: process.env.MEMOIR_BROWSER_PATH })
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, acceptDownloads: true, reducedMotion: viewport.width === 390 ? 'reduce' : 'no-preference' })
      await page.setContent('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>')
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      await page.getByRole('button', { name: '查看我的年度回忆' }).click()
      const stage = page.getByRole('region', { name: '年度报告画册' })
      const next = page.getByRole('button', { name: '下一页' })
      await page.keyboard.press('ArrowRight')
      if (viewport.width === 1280) {
        const layers = await stage.locator('[data-memoir-layer]').evaluateAll((nodes) => {
          return nodes.map((node) => {
            const animation = node.getAnimations()[0]
            if (!animation) return null
            animation.currentTime = 150
            return { direction: node.getAttribute('data-memoir-layer'), opacity: Number(getComputedStyle(node).opacity) }
          })
        })
        assert.deepEqual(layers.map((item) => item?.direction), ['outgoing', 'incoming'])
        assert.ok(layers.every((item) => item && item.opacity > 0 && item.opacity < 1))
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.locator('progress').getAttribute('value'), '2')
      } else assert.equal(await stage.locator('[data-memoir-layer="outgoing"]').count(), 0)
      await stage.locator('[data-memoir-layer="stable"]').waitFor()
      if (viewport.width === 390) {
        await stage.evaluate((el) => {
          const start = new Touch({ identifier: 1, target: el, clientX: 90, clientY: 100 })
          const end = new Touch({ identifier: 1, target: el, clientX: 180, clientY: 103 })
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
          el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
        })
      } else await page.getByRole('button', { name: '上一页' }).click()
      await stage.locator('[data-memoir-layer="stable"]').waitFor()
      const chapters = ['初次见面', '日子有功', '有话好说', '最佳损友', '念念不忘', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日']
      for (const [index, chapter] of chapters.entries()) {
        await page.getByRole('heading', { name: chapter, exact: true }).waitFor()
        if (index !== 9) await next.click()
      }
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '保存我的年度报告' }).click(),
      ])
      assert.equal(download.suggestedFilename(), '葡萄成熟时-2026.zip')
      const archive = await readFile((await download.path())!)
      const end = archive.length - 22
      assert.equal(archive.readUInt32LE(end), 0x06054b50)
      assert.equal(archive.readUInt16LE(end + 10), chapters.length)
      let directory = archive.readUInt32LE(end + 16)
      for (const [index, chapter] of chapters.entries()) {
        assert.equal(archive.readUInt32LE(directory), 0x02014b50)
        const filenameLength = archive.readUInt16LE(directory + 28)
        assert.equal(archive.toString('utf8', directory + 46, directory + 46 + filenameLength),
          `${String(index + 1).padStart(2, '0')}-${chapter}.jpg`)
        const offset = archive.readUInt32LE(directory + 42)
        const data = offset + 30 + archive.readUInt16LE(offset + 26)
        const decoded = await sharp(archive.subarray(data, data + archive.readUInt32LE(directory + 24))).raw().toBuffer({ resolveWithObject: true })
        assert.equal(decoded.info.width, 1080)
        assert.equal(decoded.info.height, 1920)
        directory += 46 + filenameLength
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
