import { prepareWizardActivityPayload, type WizardActivityPayload } from './TopicActivityWizardPayload'
import { WizardSaveSessionController, type WizardSaveSession, type WizardSnapshot } from './TopicActivityWizardSession'

export type WizardTransport = (input: string, init: RequestInit) => Promise<Response>
type Transport = WizardTransport
type SaveOptions = { transport?: Transport; timeoutMs?: number; onChange?: (state: WizardSaveSession) => void }
const idPattern = /^[A-Za-z0-9_-]{8,95}$/
export function activityFrom(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || !('activity' in body)) return null
  const activity = body.activity
  return activity && typeof activity === 'object' && !Array.isArray(activity) ? activity as Record<string, unknown> : null
}
class RejectedCreate extends Error {}

export async function requestWizardResource(transport: Transport, path: string, init: RequestInit, timeoutMs: number) {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await transport(path, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal })
        // Consume the body inside the same timeout, including a stalled response body.
        const body: unknown = await response.json().catch(() => null)
        return { response, body }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('请求超时')) }, timeoutMs) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}
export function verifyWizardActivityReadback(activity: Record<string, unknown> | null, id: string, payload: WizardActivityPayload, status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') {
  if (!activity || activity.id !== id || activity.type !== 'TOPIC_ACTIVITY' || activity.status !== status
    || activity.title !== payload.title || activity.description !== payload.description
    || activity.startsAt !== payload.startsAt || activity.endsAt !== payload.endsAt
    || activity.participationRule !== payload.participationRule || activity.participationMode !== 'COMMENT'
    || (activity.rewardGrantMode ?? 'IMMEDIATE') !== payload.rewardGrantMode || (activity.rewardGrantAt ?? null) !== payload.rewardGrantAt
    || (activity.rewardGrantMode ?? 'IMMEDIATE') !== payload.rewardGrantMode || (activity.rewardGrantAt ?? null) !== payload.rewardGrantAt
    || activity.allowImageAttachments !== payload.allowImageAttachments) throw new Error('活动回读内容不一致，请在活动管理中核对；不会重新创建')
}

/** Exactly one POST per acknowledged create. Unknown outcomes fail closed; recovery only GETs a known ID. */
export async function saveWizardActivityDraft(controller: WizardSaveSessionController, snapshot: WizardSnapshot, options: SaveOptions = {}) {
  if (controller.getState().mode !== 'API') throw new Error('真实保存必须使用 API 会话')
  const before = controller.getState()
  const recovering = before.activityId !== null
  // On recovery always verify the originally submitted snapshot, never the edited UI inputs.
  const payload = prepareWizardActivityPayload(recovering ? before.snapshot! : snapshot)
  const token = recovering ? controller.beginActivityReadback() : controller.begin(snapshot, 'DRAFT')
  if (!token) return 'BLOCKED' as const
  const changed = () => options.onChange?.(controller.getState())
  const transport = options.transport ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  changed()
  let stage: 'ACTIVITY' | 'READBACK' = recovering ? 'READBACK' : 'ACTIVITY'
  try {
    if (!recovering) {
      controller.startStage(token, 'UPLOAD'); controller.completeStage(token, 'UPLOAD', 'SKIPPED')
      controller.startStage(token, 'ACTIVITY'); changed()
      const { response, body } = await requestWizardResource(transport, '/api/admin/activities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }, timeoutMs)
      // Only known pre-create/transaction validation/auth rejections are safe to retry manually.
      if ([400, 401, 403].includes(response.status)) throw new RejectedCreate(`创建被拒绝（${response.status}），请检查输入或管理员登录状态`)
      const activity = activityFrom(body)
      if (response.status !== 201 || typeof activity?.id !== 'string' || !idPattern.test(activity.id)) throw new Error('创建响应异常')
      if (!controller.completeStage(token, 'ACTIVITY', 'SUCCEEDED', activity.id)) return 'BLOCKED' as const
      changed() // Bind the acknowledged ID before any readback can fail.
      for (const skip of ['PROGRAM', 'LOTTERY'] as const) {
        controller.startStage(token, skip); controller.completeStage(token, skip, 'SKIPPED')
      }
    }
    stage = 'READBACK'
    if (!controller.startStage(token, stage)) return 'BLOCKED' as const
    changed()
    const id = controller.getState().activityId!
    const { response, body } = await requestWizardResource(transport, `/api/admin/activities/${encodeURIComponent(id)}`, { method: 'GET' }, timeoutMs)
    if (!response.ok) throw new Error(`活动回读失败（${response.status}）；活动 ID 已保留`)
    verifyWizardActivityReadback(activityFrom(body), id, payload)
    if (!controller.completeStage(token, stage, 'SUCCEEDED')) return 'BLOCKED' as const
    return 'CONFIRMED' as const
  } catch (cause) {
    const definite = stage === 'READBACK' || cause instanceof RejectedCreate
    controller.failStage(token, stage, definite
      ? cause instanceof Error ? cause.message : '回读失败，活动 ID 已保留'
      : '创建结果不明，可能已创建。禁止再次提交；请到活动管理中核对。', definite ? 'FAILED' : 'UNKNOWN')
    return definite ? 'FAILED' as const : 'UNKNOWN' as const
  } finally { controller.finish(token); changed() }
}
