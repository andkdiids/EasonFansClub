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
          canGenerate={false} initialReport={{ nickname: '合成测试用户', uid: 42, registered: '2026-01-01',
            firstRecordedDay: null, activeDays: 12, checkIns: 8, checkInExperience: 20, posts: 3,
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
      const page = await browser.newPage({ viewport, acceptDownloads: true })
      await page.setContent('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>')
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      await page.getByRole('button', { name: '查看我的年度报告' }).click()
      const chapters = ['初次见面', '日子有功', '有话好说', '最佳损友', '好久不见', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日']
      for (const [index, chapter] of chapters.entries()) {
        await page.getByRole('heading', { name: chapter, exact: true }).waitFor()
        if (index !== 9) await page.getByRole('button', { name: '下一页' }).click()
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
