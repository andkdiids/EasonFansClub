import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reorderContentImageUrls } from '../lib/content-images'

test('内容图片排序保持 URL 唯一且可移动到任意位置', () => {
  const urls = ['a', 'b', 'c', 'd']
  assert.deepEqual(reorderContentImageUrls(urls, 0, 4), ['b', 'c', 'd', 'a'])
  assert.deepEqual(reorderContentImageUrls(urls, 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(reorderContentImageUrls(urls, 1, 3), ['a', 'c', 'b', 'd'])
  assert.deepEqual(reorderContentImageUrls(urls, 2, 3), urls)
})

test('发帖图片使用指针/HTML5 拖拽并按数组顺序写入 sortOrder', () => {
  const uploader = readFileSync('components/ContentImageUploader.tsx', 'utf8')
  const posts = readFileSync('app/api/posts/route.ts', 'utf8')
  assert.match(uploader, /onPointerDown=/)
  assert.match(uploader, /onPointerMove=/)
  assert.match(uploader, /draggable/)
  assert.match(uploader, /onDragOver=/)
  assert.match(posts, /imageUrls\.map\(\(url, sortOrder\)/)
})
