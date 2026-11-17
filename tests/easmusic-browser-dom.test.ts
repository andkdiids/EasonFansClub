import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'

test('EasMusic browser DOM boundary rebuilds one real HTMLAudioElement', { skip: process.env.EASMUSIC_BROWSER_QA !== '1' }, async (t) => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild')
  const entry = `
    import { rebuildBrowserAudioElement } from './lib/music-browser-playback';
    window.runEasMusicBoundary = () => {
      const oldAudio = document.createElement('audio');
      oldAudio.src = '/old.wav';
      let disposed = 0;
      let bound = 0;
      const nextAudio = rebuildBrowserAudioElement(
        oldAudio,
        () => document.createElement('audio'),
        () => { disposed += 1; },
        () => { bound += 1; },
      );
      return {
        oldPaused: oldAudio.paused,
        oldSourceCleared: oldAudio.getAttribute('src') === null,
        disposed,
        bound,
        replaced: nextAudio !== oldAudio,
      };
    };
  `
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [{
      name: 'typescript-entry',
      setup(build: { onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => { contents: string; loader: string }) => void }) {
        build.onLoad({ filter: /lib[\\/]music-browser-playback\.ts$/ }, (args) => ({ contents: require('node:fs').readFileSync(args.path, 'utf8'), loader: 'ts' }))
      },
    }],
  })
  const bundle = built.outputFiles[0].text
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(bundle)
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><meta charset="utf-8"><script src="/bundle.js"></script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let browser: Browser | null = null
  try {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    try {
      browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
    } catch (error) {
      if (process.env.EASMUSIC_BROWSER_QA === '1') throw error
      t.skip(`本机没有可用 Chromium/Edge，未伪报浏览器结果：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const page = await browser.newPage()
    await page.goto(origin)
    const result = await page.evaluate(() => window.runEasMusicBoundary())
    assert.deepEqual(result, {
      oldPaused: true,
      oldSourceCleared: true,
      disposed: 1,
      bound: 1,
      replaced: true,
    })
    await page.close()
  } finally {
    await browser?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

declare global {
  interface Window {
    runEasMusicBoundary: () => {
      oldPaused: boolean
      oldSourceCleared: boolean
      disposed: number
      bound: number
      replaced: boolean
    }
  }
}
