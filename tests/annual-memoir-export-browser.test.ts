import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chromium } from 'playwright'
import sharp from 'sharp'
import ts from 'typescript'

test('browser creates a ZIP with ten independently decodable full-size JPEGs', {
  skip: !process.env.MEMOIR_BROWSER_PATH && process.env.MEMOIR_BROWSER_QA !== '1',
}, async () => {
  const browser = await chromium.launch({ executablePath: process.env.MEMOIR_BROWSER_PATH })
  try {
    const page = await browser.newPage()
    const source = readFileSync('lib/annual-memoir-export.ts', 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const titles = ['初次见面', '日子有功', '有话好说', '最佳损友', '好久不见', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日']
    const result = await page.evaluate(async ({ compiled, titles }) => {
      const exports = {} as typeof import('../lib/annual-memoir-export')
      new Function('exports', compiled)(exports)
      const progress: number[] = []
      const zip = await exports.renderMemoirZip(titles.map((title) => [title, '中文测试 · 私家E院']), 2026, (n) => progress.push(n))
      return { archive: Array.from(new Uint8Array(await zip.arrayBuffer())), progress }
    }, { compiled, titles })
    const zip = Buffer.from(result.archive)
    const end = zip.length - 22
    assert.equal(zip.readUInt32LE(end), 0x06054b50)
    assert.equal(zip.readUInt16LE(end + 10), 10)
    let directory = zip.readUInt32LE(end + 16)
    for (const [index, title] of titles.entries()) {
      assert.equal(zip.readUInt32LE(directory), 0x02014b50)
      const length = zip.readUInt16LE(directory + 28)
      assert.equal(zip.toString('utf8', directory + 46, directory + 46 + length), `${String(index + 1).padStart(2, '0')}-${title}.jpg`)
      const offset = zip.readUInt32LE(directory + 42)
      assert.equal(zip.readUInt32LE(offset), 0x04034b50)
      const data = offset + 30 + zip.readUInt16LE(offset + 26)
      const jpg = zip.subarray(data, data + zip.readUInt32LE(directory + 24))
      const image = sharp(jpg)
      const metadata = await image.metadata()
      assert.equal(metadata.format, 'jpeg')
      assert.equal(metadata.width, 1080)
      assert.equal(metadata.height, 1920)
      await image.raw().toBuffer()
      directory += 46 + length
    }
    assert.deepEqual(result.progress, titles.map((_, i) => i + 1))
  } finally {
    await browser.close()
  }
})
