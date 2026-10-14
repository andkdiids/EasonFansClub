import { createDefaultTopicActivityV2Program, normalizeTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { prepareWizardActivityPayload, prepareWizardProgramPayload } from './TopicActivityWizardPayload'
import { activityFrom, requestWizardResource, verifyWizardActivityReadback, type WizardTransport } from './TopicActivityWizardActivitySave'
import { WizardSaveSessionController, type WizardSaveSession, type WizardSnapshot } from './TopicActivityWizardSession'

type Options = { transport?: WizardTransport; timeoutMs?: number; onChange?: (state: WizardSaveSession) => void }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
// Key order is not a semantic difference; array order (options, entries, results) is significant.
export function canonicalWizardValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalWizardValue).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalWizardValue(record(value)[key])).join(',') + '}'
  return JSON.stringify(value)
}
export function wizardProgramsMatch(value: unknown, expected: unknown): boolean {
  if (!value) return false
  const actual = normalizeTopicActivityV2Program(value), target = normalizeTopicActivityV2Program(expected)
  return actual.valid && target.valid && canonicalWizardValue(actual.value) === canonicalWizardValue(target.value)
}
class RejectedSave extends Error {}

/** Only current-wizard drafts are eligible; preflight refuses existing divergent configurations. */
export async function saveWizardProgram(controller: WizardSaveSessionController, snapshot: WizardSnapshot, options: Options = {}) {
  const operation = controller.beginProgramSave(snapshot)
  if (!operation) return 'BLOCKED' as const
  const { token, readOnly } = operation
  const changed = () => options.onChange?.(controller.getState())
  const transport = options.transport ?? fetch, timeout = options.timeoutMs ?? 30_000
  let stage: 'PREFLIGHT' | 'SAVE' | 'READBACK' = readOnly ? 'READBACK' : 'PREFLIGHT'
  changed()
  try {
    const state = controller.getState(), id = state.activityId!
    const payload = prepareWizardProgramPayload(state.programSave.snapshot!)
    const basePayload = prepareWizardActivityPayload(state.snapshot!)
    const base = `/api/admin/activities/${encodeURIComponent(id)}`
    const activity = await requestWizardResource(transport, base, { method: 'GET' }, timeout)
    if (!activity.response.ok) throw new Error('活动草稿核验失败，未授权覆盖配置')
    verifyWizardActivityReadback(activityFrom(activity.body), id, basePayload)
    const current = await requestWizardResource(transport, base + '/v2', { method: 'GET' }, timeout)
    if (!current.response.ok || record(record(current.body).activity).id !== id || record(record(current.body).activity).status !== 'DRAFT'
      || record(current.body).canReview !== true || !Object.hasOwn(record(current.body), 'program')) throw new Error('V2 回读身份或权限不一致')
    const existing = record(current.body).program
    if (wizardProgramsMatch(existing, payload.program)) {
      return controller.confirmProgramReadback(token) ? 'CONFIRMED' as const : 'BLOCKED' as const
    }
    if (readOnly) throw new Error('V2 回读与提交快照不一致。结果仍需核对，禁止重复 PATCH')
    // Existing admin GET returns this exact disabled default when topicProgram is absent.
    // Accept only that precise default, never an arbitrary disabled/nonempty configuration.
    if (existing !== null && !wizardProgramsMatch(existing, createDefaultTopicActivityV2Program())) throw new Error('活动已有其他 V2 配置，停止保存；不会覆盖')
    // No automatic retries. Once PATCH may have reached the server, future clicks are read-only.
    if (!controller.markProgramWriteStarted(token)) return 'BLOCKED' as const
    stage = 'SAVE'; changed()
    const saved = await requestWizardResource(transport, base + '/v2', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }, timeout)
    if ([400, 401, 403, 409].includes(saved.response.status)) throw new RejectedSave(`V2 保存被拒绝（${saved.response.status}）`)
    if (!saved.response.ok || !wizardProgramsMatch(record(saved.body).program, payload.program)) throw new Error('V2 保存响应无法确认')
    if (!controller.acknowledgeProgramWrite(token)) return 'BLOCKED' as const
    stage = 'READBACK'; changed()
    const confirmed = await requestWizardResource(transport, base + '/v2', { method: 'GET' }, timeout)
    const body = record(confirmed.body), activityView = record(body.activity)
    if (!confirmed.response.ok || activityView.id !== id || activityView.status !== 'DRAFT' || body.canReview !== true
      || !wizardProgramsMatch(body.program, payload.program)) throw new Error('V2 保存后回读不一致；保留活动 ID 与提交快照，不重复保存')
    if (!controller.confirmProgramReadback(token)) return 'BLOCKED' as const
    return 'CONFIRMED' as const
  } catch (cause) {
    const unknown = stage === 'SAVE' && !(cause instanceof RejectedSave)
    controller.failProgramSave(token, stage, unknown ? 'V2 保存结果不明，可能已写入；仅可回读核对，不自动重发。'
      : cause instanceof Error ? cause.message : 'V2 保存核验失败', unknown)
    return unknown ? 'UNKNOWN' as const : 'FAILED' as const
  } finally { controller.finish(token); changed() }
}
