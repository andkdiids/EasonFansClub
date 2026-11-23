import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
          preview initialReport={{ nickname: '想把故事留在葡萄树下的长昵称合成测试用户', uid: 747272, registered: '2026-01-01',
            firstPost: { excerpt: '这是合成验收账号写下的第一篇帖子。', date: '2026-08-18' },
            topPeer: { nickname: '合成验收 EF', wall: 2, comments: 3 },
            communityMemory: { kind: 'POST', excerpt: '散场后我们一路哼着歌。', date: '2026-10-18' },
            bestGame: { score: 128, mode: '粤语残片' }, monthlyFirsts: 1, weeklyFirsts: 3,
            activeDays: 987654321, checkIns: 8, checkInExperience: 20, posts: 3,
            replies: 6, likesGiven: 20, likesReceived: 9, friends: 2, followers: 3, games: 2,
            bestScore: 8, badges: 1, topics: 2, offlineMeetups: 1, title: '故事记录者', message: '年度寄语' }} />)
      `,
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': process.cwd(), 'next/link': './tests/fixtures/memoir-browser-link.tsx' },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ executablePath: process.env.MEMOIR_BROWSER_PATH })
  const output = process.env.MEMOIR_QA_OUTPUT
  try {
    if (output) await mkdir(output, { recursive: true })
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, acceptDownloads: true, reducedMotion: viewport.width === 390 ? 'reduce' : 'no-preference' })
      await page.route('http://memoir-fixture.test/', (route) => route.fulfill({
        contentType: 'text/html', body: '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>',
      }))
      await page.goto('http://memoir-fixture.test/')
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      await page.getByRole('dialog', { name: '葡萄成熟时年度回忆录' }).waitFor()
      const stage = page.getByRole('region', { name: '年度报告画册' })
      const next = page.getByRole('button', { name: '下一页' })
      if (viewport.width === 1280) {
        await page.evaluate(() => {
          for (let i = 0; i < 2; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
        })
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
        assert.equal(await page.locator('.memoir-reader-bar [role="status"]').textContent(), '2 / 10')
        if (output) await page.screenshot({ path: join(output, 'crossfade-desktop.png') })
      } else {
        await page.keyboard.press('ArrowRight')
        assert.equal(await stage.locator('[data-memoir-layer="outgoing"]').count(), 0)
      }
      await stage.locator('[data-memoir-layer="stable"]').waitFor()
      if (viewport.width === 390) {
        await stage.evaluate((el) => {
          const start = new Touch({ identifier: 1, target: el, clientX: 180, clientY: 100 })
          const end = new Touch({ identifier: 1, target: el, clientX: 270, clientY: 103 })
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
          el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
        })
      } else await page.getByRole('button', { name: '上一页' }).click()
      await stage.locator('[data-memoir-layer="stable"]').waitFor()
      const chapters = ['初次见面', '日子有功', '有话好说', '最佳损友', '念念不忘', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日']
      for (const [index, chapter] of chapters.entries()) {
        await page.getByRole('heading', { name: chapter, exact: true }).waitFor()
        if (output && [0, 4, 8].includes(index)) {
          await stage.locator('[data-memoir-layer="stable"]').waitFor()
          await stage.locator('canvas').screenshot({ path: join(output, `chapter-${index + 1}-${viewport.width}.png`) })
        }
        if (index !== 9) await next.click()
      }
      await stage.locator('[data-memoir-layer="stable"]').waitFor()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '下载全部图片（ZIP）' }).click(),
      ]).catch(async (cause) => {
        throw new Error('ZIP control status: ' + await page.getByRole('dialog').innerText(), { cause })
      })
      assert.equal(download.suggestedFilename(), '葡萄成熟时-2026.zip')
      const archive = await readFile((await download.path())!)
      if (output && viewport.width === 390) await writeFile(join(output, download.suggestedFilename()), archive)
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
        if (output && viewport.width === 390 && [4, 8].includes(index)) {
          await writeFile(join(output, `${index + 1}-${chapter}.jpg`), archive.subarray(data, data + archive.readUInt32LE(directory + 24)))
        }
        directory += 46 + filenameLength
      }
      await page.close()
    }
    for (const width of [320, 360, 375, 390, 414, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 720 }, isMobile: true, hasTouch: true,
        reducedMotion: 'reduce', userAgent: 'Mobile MicroMessenger/8.0' })
      await page.setContent('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><nav aria-label="站点导航"><a href="/">首页</a></nav><div id="root"></div>')
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert.equal(await page.evaluate(() => {
        const outside = document.querySelector<HTMLElement>('nav a')!
        outside.focus()
        return document.activeElement === outside
      }), false)
      assert.equal(await page.getByRole('button', { name: '下一页' }).isVisible(), false)
      const stage = page.getByRole('region', { name: '年度报告画册' })
      const dimensions = await stage.locator('canvas').evaluate((canvas) => {
        const frame = canvas.closest('dialog')!.getBoundingClientRect()
        const image = canvas.getBoundingClientRect()
        return { viewport: innerHeight, frame: frame.height, image: image.width / image.height,
          contained: image.left >= frame.left && image.right <= frame.right && image.top >= frame.top && image.bottom <= frame.bottom }
      })
      assert.equal(dimensions.frame, dimensions.viewport)
      assert.ok(dimensions.contained && Math.abs(dimensions.image - 9 / 16) < 0.006)
      const client = await page.context().newCDPSession(page)
      const swipe = async (dx: number, dy = 0) => {
        const x = Math.round(width / 2)
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 250 }] })
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: 250 + dy }] })
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      const hint = page.getByText('← 向左轻滑，翻开下一页')
      await hint.waitFor()
      if (width === 390 && output) await page.screenshot({ path: join(output, 'reader-left-hint.png') })
      await swipe(90)
      await swipe(13, 140)
      await page.touchscreen.tap(width / 2, 250)
      assert.equal(await stage.getByRole('heading', { name: '初次见面' }).count(), 1)
      await swipe(-90)
      await stage.getByRole('heading', { name: '日子有功' }).waitFor()
      assert.equal(await hint.count(), 0)
      if (width === 390 && output) await page.screenshot({ path: join(output, 'reader-left-swipe-page-2.png') })
      await swipe(90)
      await stage.getByRole('heading', { name: '初次见面' }).waitFor()
      if (width === 390) {
        for (let index = 0; index < 9; index++) await swipe(-90)
        await stage.getByRole('heading', { name: '明年今日' }).waitFor()
        await swipe(-90)
        assert.equal(await stage.getByRole('heading', { name: '明年今日' }).count(), 1)
        await page.getByRole('button', { name: '逐张保存图片' }).click()
        const gallery = page.getByRole('region', { name: '年度回忆图片' })
        const first = gallery.getByRole('img', { name: '初次见面' })
        await first.waitFor()
        await swipe(90)
        assert.equal(await first.count(), 1)
        assert.equal(await first.evaluate((image) =>
          image.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), true)
        await swipe(-90)
        const second = gallery.getByRole('img', { name: '日子有功' })
        await second.waitFor()
        assert.equal(await gallery.locator('header span').textContent(), '2 / 10')
        if (output) await page.screenshot({ path: join(output, 'gallery-left-swipe-image-2.png') })
        await swipe(90)
        await first.waitFor()
        if (output) await page.screenshot({ path: join(output, 'gallery-right-swipe-image-1.png') })
        await gallery.getByRole('button', { name: '下一张' }).click()
        await second.waitFor()
        await gallery.getByRole('button', { name: '上一张' }).click()
        await first.waitFor()
        for (const [index, title] of ['初次见面', '日子有功', '有话好说', '最佳损友', '念念不忘', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日'].entries()) {
          const image = gallery.getByRole('img', { name: title })
          const natural = await image.evaluate(async (img: HTMLImageElement) => {
            await img.decode()
            return [img.naturalWidth, img.naturalHeight, img.src.startsWith('blob:')]
          })
          assert.deepEqual(natural, [1080, 1920, true])
          if (output && index === 0) await page.screenshot({ path: join(output, 'wechat-user-agent-gallery.png') })
          if (index < 9) await gallery.getByRole('button', { name: '下一张' }).click()
        }
        await swipe(-90)
        assert.equal(await gallery.locator('header span').textContent(), '10 / 10')
        await gallery.getByRole('button', { name: '返回画册' }).click()
        await stage.getByRole('heading', { name: '明年今日' }).waitFor()
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
