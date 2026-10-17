import assert from 'node:assert/strict'
import { createElement } from 'react'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { TopicActivityWizardTestEditor } from '@/components/activities/TopicActivityWizardTestEditor'
import { createDefaultTopicActivityV2Program, topicActivityV2PosterBackground } from '@/lib/topic-activity-v2-config'

test('test editor renders one shared poster background uploader and no per-result upload controls', () => {
  const config = createDefaultTopicActivityV2Program()
  config.test.enabled = true
  config.test.results = [
    { id: 'result-one', title: '结果一', description: '说明一', imageUrl: '/uploads/legacy-one.webp' },
    { id: 'result-two', title: '结果二', description: '说明二', imageUrl: '/uploads/legacy-two.webp' },
  ]
  const runtime = globalThis as typeof globalThis & { React?: typeof React }
  const previousReact = runtime.React
  runtime.React = React
  let markup: string
  try {
    markup = renderToStaticMarkup(createElement(TopicActivityWizardTestEditor, { value: config.test, onChange: () => undefined }))
  } finally {
    if (previousReact) runtime.React = previousReact
    else Reflect.deleteProperty(runtime, 'React')
  }

  assert.equal((markup.match(/统一结果海报背景上传文件/gu) || []).length, 1)
  assert.doesNotMatch(markup, /结果\s*\d+\s*图片上传文件/u)
  assert.match(markup, /建议尺寸：1080 × 1440/u)
  assert.match(markup, /此背景将用于该测试的所有结果海报/u)
  assert.match(markup, /legacy-one\.webp/u, 'the legacy image remains available for old activities')
})

test('shared poster background wins, and the first nonempty legacy result image is the fallback', () => {
  const config = createDefaultTopicActivityV2Program()
  config.test.results = [
    { id: 'result-one', title: '结果一', description: '说明一', imageUrl: '  ' },
    { id: 'result-two', title: '结果二', description: '说明二', imageUrl: '/uploads/legacy-two.webp' },
    { id: 'result-three', title: '结果三', description: '说明三', imageUrl: '/uploads/legacy-three.webp' },
  ]

  assert.equal(topicActivityV2PosterBackground(config.test), '/uploads/legacy-two.webp')
  config.test.poster.backgroundUrl = '/uploads/shared.webp'
  assert.equal(topicActivityV2PosterBackground(config.test), '/uploads/shared.webp')
  config.test.poster.backgroundUrl = null
  assert.equal(topicActivityV2PosterBackground(config.test), '/uploads/legacy-two.webp')
})
