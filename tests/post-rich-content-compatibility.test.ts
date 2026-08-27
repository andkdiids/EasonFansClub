import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { plainTextToRichContent } from '../lib/rich-text'
import {
  POST_RICH_CONTENT_DB_ENABLED,
  resolvePostContentInput,
} from '../lib/post-rich-content-compat'

const read = (path: string) => readFileSync(path, 'utf8')

test('生产兼容开关关闭 richContent 数据库读写', () => {
  assert.equal(POST_RICH_CONTENT_DB_ENABLED, false)
  const detailPage = read('app/posts/[postId]/page.tsx')
  const detailApi = read('app/api/posts/[postId]/route.ts')
  const editApi = read('app/api/posts/[postId]/edit/route.ts')
  const editPage = read('app/posts/[postId]/edit/page.tsx')
  const searchPage = read('app/search/page.tsx')

  assert.doesNotMatch(detailPage, /richContent:\s*true/)
  assert.doesNotMatch(detailPage, /post\.richContent/)
  assert.match(detailPage, /richContent=\{null\}/)
  assert.match(detailApi, /select: postDetailSelect/)
  assert.doesNotMatch(detailApi, /include:\s*\{/)
  assert.doesNotMatch(detailApi, /richContent:\s*true/)
  assert.doesNotMatch(detailApi, /postData\.richContent/)
  assert.doesNotMatch(editApi, /richContent:\s*true/)
  assert.doesNotMatch(editApi, /post\.richContent/)
  assert.doesNotMatch(editPage, /richContent:\s*true|post\.richContent/)
  assert.match(searchPage, /select:\s*\{[\s\S]*?replyCount:\s*true[\s\S]*?User:/)
  assert.doesNotMatch(searchPage, /include:\s*\{[\s\S]*?Board:/)
  assert.doesNotMatch(searchPage, /richContent:\s*true/)
})

test('富文本请求在兼容模式下提取纯文本而不产生数据库写入字段', () => {
  const richContent = plainTextToRichContent('第一段\n第二段')
  const result = resolvePostContentInput({
    content: '旧版正文',
    richContent,
    hasRichContent: true,
  })

  assert.equal(result.content, '第一段\n第二段')
  assert.equal(result.usedCompatibilityMode, true)
  assert.equal(result.validation?.valid, true)
  assert.equal(resolvePostContentInput({ content: '旧版正文', richContent: null, hasRichContent: true }).content, '旧版正文')
})

test('创建和编辑事务只提交生产已存在的 content 字段', () => {
  const create = read('app/api/posts/route.ts')
  const edit = read('app/api/posts/[postId]/route.ts')
  const createData = create.slice(create.indexOf('const post = await tx.post.create'))
  const editData = edit.slice(edit.indexOf('const updatedPost = await tx.post.update'))

  assert.match(createData, /content: input\.content/)
  assert.doesNotMatch(createData.slice(0, createData.indexOf('select:')), /richContent\s*:/)
  assert.match(editData, /content: rawContent/)
  assert.doesNotMatch(editData.slice(0, editData.indexOf('select:')), /richContent\s*:/)
})
