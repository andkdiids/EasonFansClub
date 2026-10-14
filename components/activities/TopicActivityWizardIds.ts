import type { TopicActivityV2PollOption } from '@/lib/topic-activity-v2-config'

export type WizardIdKind = 'draft' | 'task' | 'prize' | 'option' | 'poll' | 'test' | 'snapshot' | 'session' | 'request' | 'image'

/** Generate once at entity creation; never regenerate in an adapter or retry. */
export function createWizardId(kind: WizardIdKind): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('当前环境不支持安全生成标识，请使用 HTTPS 或本地测试环境')
  return `${kind}-${globalThis.crypto.randomUUID()}`
}

export function createWizardOption(label = ''): TopicActivityV2PollOption {
  return { id: createWizardId('option'), label }
}
