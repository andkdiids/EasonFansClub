import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { TopicLotteryError } from '@/lib/topic-activity-v2-lottery-config'
import { TopicLotteryPiiError } from '@/lib/topic-activity-v2-lottery-private'

const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const original = loader._load
type Handler<Params extends Record<string, string>> = (request: Request, context: { params: Promise<Params> }) => Promise<Response>

let viewer: 'anonymous' | 'owner' | 'other' | 'admin' = 'anonymous'
let manage = false
let shipping = false
let serviceFailure: 'none' | 'lottery' | 'pii' | 'unknown' = 'none'
let calls: {
  publicView: Array<[string, string | undefined]>
  adminView: string[]
  saveConfig: Array<{ activityId: string; actorId: string; config: unknown }>
  draw: Array<Record<string, unknown>>
  notices: Array<Record<string, unknown>>
  address: Array<{ activityId: string; winnerId: string; userId: string }>
  saveAddress: Array<Record<string, unknown>>
  adminAddress: Array<{ activityId: string; winnerId: string; actorId: string }>
  shipment: Array<Record<string, unknown>>
} = {
  publicView: [], adminView: [], saveConfig: [], draw: [], notices: [], address: [], saveAddress: [], adminAddress: [], shipment: [],
}

let publicLottery: { GET: Handler<{ activityId: string }> }
let ownerAddress: { GET: Handler<{ activityId: string; winnerId: string }>; PUT: Handler<{ activityId: string; winnerId: string }> }
let adminLottery: { GET: Handler<{ activityId: string }>; PATCH: Handler<{ activityId: string }> }
let drawLottery: { POST: Handler<{ activityId: string }> }
let notifications: { POST: Handler<{ activityId: string }> }
let adminAddress: { GET: Handler<{ activityId: string; winnerId: string }> }
let shipment: { POST: Handler<{ activityId: string; winnerId: string }> }

const denied = (status: number) => ({ user: null, response: new Response('{}', { status }) })
const userFor = (request: Request) => {
  const token = request.headers.get('authorization')
  if (token === 'Bearer owner-token') return { id: 'owner', role: 'USER' }
  if (token === 'Bearer other-token') return { id: 'other', role: 'USER' }
  if (token === 'Bearer admin-token') return { id: 'admin', role: 'ADMIN' }
  return viewer === 'anonymous' ? null : { id: viewer, role: viewer === 'admin' ? 'ADMIN' : 'USER' }
}
const defaultContext = { params: Promise.resolve({ activityId: 'activity-one' }) }
function makeContext<T extends { activityId: string }>(params: T) {
  return { params: Promise.resolve(params) }
}
const request = (method = 'GET', body?: unknown, headers: Record<string, string> = {}) => new Request('http://localhost/api', {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const responseBody = async (response: Response) => await response.json() as Record<string, unknown>

before(async () => {
  loader._load = function (requestName, parent, main) {
    if (requestName === '@/lib/security') return {
      resolveRequestAuth: async (request: Request) => {
        const user = userFor(request)
        if (request.headers.has('authorization') && !user) return { user: null, response: new Response('{}', { status: 401 }) }
        return { user, response: null }
      },
      requireRequestUser: async (request: Request) => {
        const user = userFor(request)
        return user ? { user, response: null } : denied(401)
      },
      requireRequestAdmin: async (request: Request) => {
        const user = userFor(request)
        return user && manage ? { user: { ...user, id: 'admin', role: 'ADMIN' }, response: null } : denied(user ? 403 : 401)
      },
      rejectInvalidRequestOrigin: (req: Request) => req.headers.get('origin') === 'https://hostile.invalid' ? new Response('{}', { status: 403 }) : null,
      enforceApiRateLimit: async () => null,
    }
    if (requestName === '@/lib/admin-permissions') return {
      hasAdminPermission: async (_user: unknown, permission?: string) => permission === 'activity_lottery_shipping' ? shipping : manage,
    }
    if (requestName === '@/lib/topic-activity-v2-lottery') return {
      getTopicLotteryView: async (activityId: string, viewerId?: string) => {
        calls.publicView.push([activityId, viewerId])
        const prize = { id: 'prize-one', name: '实物奖', description: '公开奖品', imageUrl: '/cos/activities/asset-one/source.webp', quantity: 1, sortOrder: 0 }
        return { enabled: true, config: { version: 1, enabled: true, title: '幸运抽奖', prizes: [prize] }, state: 'DRAWN', myStatus: viewerId ? 'ELIGIBLE' : 'LOGIN_REQUIRED',
          myWinner: { id: 'winner-one', prize, address: 'never-public' }, winners: [{ id: 'public-winner', prizeName: '实物奖', address: 'never-public' }] }
      },
      getAdminTopicLotteryView: async (activityId: string) => {
        calls.adminView.push(activityId)
        if (serviceFailure === 'lottery') throw new TopicLotteryError('LOTTERY_DRAW_FAILED', '开奖尚未完成，请稍后重试', 503)
        if (serviceFailure === 'unknown') throw new Error('raw-secret-database-detail')
        return { config: {}, configLocked: false, addressEncryptionReady: true, state: 'READY_TO_DRAW', candidateCount: 2, pendingSubmissionCount: 0,
          winners: [{ id: 'winner-one', prizeName: '实物奖', address: 'secret-address', phone: 'secret-phone', status: 'PENDING' }], draw: null }
      },
      saveTopicLotteryConfig: async (activityId: string, actorId: string, config: unknown) => {
        calls.saveConfig.push({ activityId, actorId, config })
        return config
      },
      drawTopicLottery: async (input: Record<string, unknown>) => {
        calls.draw.push(input)
        return { changed: true, drawId: 'draw-one', winnerCount: 1 }
      },
    }
    if (requestName === '@/lib/topic-activity-v2-lottery-fulfillment') return {
      getTopicLotteryAddress: async (activityId: string, winnerId: string, userId: string) => {
        calls.address.push({ activityId, winnerId, userId })
        if (serviceFailure === 'pii') throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_KEY_UNAVAILABLE', '抽奖收件加密密钥未配置', 503)
        if (activityId !== 'activity-one' || winnerId !== 'winner-one' || userId !== 'owner') throw { code: 'WINNER_NOT_FOUND', message: '中奖记录不存在', status: 404 }
        return { winner: { id: winnerId, prizeName: '实物奖', addressDeadline: '2026-11-01T00:00:00.000Z', shippingStatus: 'WAITING_ADDRESS' },
          address: { recipient: '收件人', phone: '13800000000', province: '广东', city: '广州', district: '天河', address: '私密地址', remark: null }, shipment: null }
      },
      saveTopicLotteryAddress: async (input: Record<string, unknown>) => {
        calls.saveAddress.push(input)
        return { saved: true }
      },
      getAdminTopicLotteryAddress: async (activityId: string, winnerId: string, actorId: string) => {
        calls.adminAddress.push({ activityId, winnerId, actorId })
        if (activityId !== 'activity-one' || winnerId !== 'winner-one') throw { code: 'WINNER_NOT_FOUND', message: '中奖记录不存在', status: 404 }
        return { winner: { id: winnerId, prizeName: '实物奖', addressDeadline: '2026-11-01T00:00:00.000Z', shippingStatus: 'WAITING_ADDRESS' },
          address: { recipient: '收件人', phone: '13800000000', province: '广东', city: '广州', district: '天河', address: '私密地址', remark: null }, shipment: null }
      },
      updateTopicLotteryShipment: async (input: Record<string, unknown>) => {
        calls.shipment.push(input)
        return { updated: true, action: input.action }
      },
      deliverTopicLotteryNotices: async (input: Record<string, unknown>) => {
        calls.notices.push(input)
        return { scanned: 1, sent: 1, failed: 0 }
      },
    }
    return original.call(this, requestName, parent, main)
  }
  try {
    publicLottery = await import('../app/api/activities/[activityId]/v2/lottery/route')
    ownerAddress = await import('../app/api/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route')
    adminLottery = await import('../app/api/admin/activities/[activityId]/v2/lottery/route')
    drawLottery = await import('../app/api/admin/activities/[activityId]/v2/lottery/draw/route')
    notifications = await import('../app/api/admin/activities/[activityId]/v2/lottery/notifications/route')
    adminAddress = await import('../app/api/admin/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route')
    shipment = await import('../app/api/admin/activities/[activityId]/v2/lottery/winners/[winnerId]/shipment/route')
  } finally {
    loader._load = original
  }
})

beforeEach(() => {
  viewer = 'anonymous'; manage = false; shipping = false; serviceFailure = 'none'
  calls = { publicView: [], adminView: [], saveConfig: [], draw: [], notices: [], address: [], saveAddress: [], adminAddress: [], shipment: [] }
})

test('public lottery GET permits anonymous and optional Bearer viewers without exposing address data', async () => {
  let result = await publicLottery.GET(request(), defaultContext)
  assert.equal(result.status, 200)
  let body = await responseBody(result)
  assert.equal(body.myStatus, 'LOGIN_REQUIRED')
  assert.equal((body.winners as Array<Record<string, unknown>>)[0].address, undefined)
  assert.equal((((body.config as Record<string, unknown>).prizes as Array<Record<string, unknown>>)[0]).imageUrl, '/cos/activities/asset-one/source.webp', 'anonymous public contract carries stable prize object reference')
  assert.equal(((body.myWinner as Record<string, unknown>).address), undefined)
  assert.equal((((body.myWinner as Record<string, unknown>).prize as Record<string, unknown>).imageUrl), '/cos/activities/asset-one/source.webp', 'winner view carries the same stable image reference')
  assert.deepEqual(calls.publicView, [['activity-one', undefined]])

  result = await publicLottery.GET(request('GET', undefined, { authorization: 'Bearer owner-token' }), defaultContext)
  assert.equal(result.status, 200)
  body = await responseBody(result)
  assert.equal(body.myStatus, 'ELIGIBLE')
  assert.deepEqual(calls.publicView[1], ['activity-one', 'owner'])
  assert.match(result.headers.get('cache-control') || '', /private/i)
  assert.match(result.headers.get('vary') || '', /Authorization/)
})

test('admin lottery GET/PATCH use activity_manage, expose canShip, and keep overview rows redacted', async () => {
  assert.equal((await adminLottery.GET(request(), defaultContext)).status, 401)
  viewer = 'admin'
  assert.equal((await adminLottery.GET(request(), defaultContext)).status, 403)
  manage = true
  const response = await adminLottery.GET(request(), defaultContext)
  assert.equal(response.status, 200)
  let body = await responseBody(response)
  assert.equal(body.canShip, false)
  assert.equal(body.addressEncryptionReady, true)
  assert.equal((body.winners as Array<Record<string, unknown>>)[0].address, undefined)
  assert.equal((body.winners as Array<Record<string, unknown>>)[0].phone, undefined)
  shipping = true
  body = await responseBody(await adminLottery.GET(request(), defaultContext))
  assert.equal(body.canShip, true)
  assert.equal((body.winners as Array<Record<string, unknown>>)[0].address, undefined)

  assert.equal((await adminLottery.PATCH(request('PATCH', { config: {}, now: 'client-controlled' }), defaultContext)).status, 400)
  assert.equal(calls.saveConfig.length, 0)
  const saved = await adminLottery.PATCH(request('PATCH', { config: { enabled: false } }, { authorization: 'Bearer admin-token' }), defaultContext)
  assert.equal(saved.status, 200)
  assert.deepEqual(calls.saveConfig, [{ activityId: 'activity-one', actorId: 'admin', config: { enabled: false } }])
})

test('draw and notification handlers require hostile-origin protection, exact request shapes, and server-owned timing', async () => {
  viewer = 'admin'; manage = true
  assert.equal((await drawLottery.POST(request('POST', {}, { origin: 'https://hostile.invalid' }), defaultContext)).status, 403)
  assert.equal((await drawLottery.POST(request('POST', { now: '2026-01-01', seed: 'client', winners: [] }), defaultContext)).status, 400)
  assert.equal(calls.draw.length, 0)
  assert.equal((await drawLottery.POST(request('POST', {}), defaultContext)).status, 200)
  assert.deepEqual(calls.draw, [{ activityId: 'activity-one', actorId: 'admin', trigger: 'MANUAL' }])

  assert.equal((await notifications.POST(request('POST', {}), defaultContext)).status, 400)
  assert.equal((await notifications.POST(request('POST', { retry: true, now: 'client-controlled' }), defaultContext)).status, 400)
  assert.equal(calls.notices.length, 0)
  assert.equal((await notifications.POST(request('POST', { retry: true, batchSize: 2 }), defaultContext)).status, 200)
  assert.deepEqual(calls.notices, [{ activityId: 'activity-one', batchSize: 2 }])
})

test('owner address route keeps owner/activity scope and rejects consent, extra control fields, oversized bodies, and hostile origins', async () => {
  assert.equal((await ownerAddress.GET(request(), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 401)
  const ownerRequest = () => request('GET', undefined, { authorization: 'Bearer owner-token' })
  const result = await ownerAddress.GET(ownerRequest(), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))
  assert.equal(result.status, 200)
  const ownerBody = await responseBody(result)
  assert.equal(ownerBody.address && (ownerBody.address as Record<string, unknown>).recipient, '收件人')
  assert.deepEqual(calls.address[0], { activityId: 'activity-one', winnerId: 'winner-one', userId: 'owner' })

  const foreign = await ownerAddress.GET(request('GET', undefined, { authorization: 'Bearer other-token' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))
  assert.equal(foreign.status, 404)
  const foreignActivity = await ownerAddress.GET(ownerRequest(), makeContext({ activityId: 'foreign-activity', winnerId: 'winner-one' }))
  assert.equal(foreignActivity.status, 404)

  viewer = 'owner'
  assert.equal((await ownerAddress.PUT(request('PUT', { address: { recipient: '收件人' }, consent: false }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 400)
  assert.equal((await ownerAddress.PUT(request('PUT', { address: { recipient: '收件人' }, consent: true, now: 'client-controlled' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 400)
  assert.equal((await ownerAddress.PUT(request('PUT', { address: { recipient: '收件人' }, consent: true }, { origin: 'https://hostile.invalid' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 403)
  const oversized = new Request('http://localhost/api', { method: 'PUT', headers: { 'content-length': '262145' }, body: '{}' })
  assert.equal((await ownerAddress.PUT(oversized, makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 400)
  assert.equal(calls.saveAddress.length, 0)
  assert.equal((await ownerAddress.PUT(request('PUT', { address: { recipient: '收件人' }, consent: true }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 200)
  assert.deepEqual(calls.saveAddress, [{ activityId: 'activity-one', winnerId: 'winner-one', userId: 'owner', address: { recipient: '收件人' }, consent: true }])
})

test('address PII and shipment mutation require both admin permissions and keep client controls out', async () => {
  viewer = 'admin'; manage = true
  assert.equal((await adminAddress.GET(request(), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 403)
  assert.equal(calls.adminAddress.length, 0)
  shipping = true
  const result = await adminAddress.GET(request(), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))
  assert.equal(result.status, 200)
  assert.equal(((await responseBody(result)).address as Record<string, unknown>).phone, '13800000000')
  assert.deepEqual(calls.adminAddress, [{ activityId: 'activity-one', winnerId: 'winner-one', actorId: 'admin' }])

  shipping = false
  assert.equal((await shipment.POST(request('POST', { action: 'SHIP' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 403)
  shipping = true
  assert.equal((await shipment.POST(request('POST', { action: 'SHIP', now: 'client-controlled' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 400)
  assert.equal((await shipment.POST(request('POST', { action: 'UNKNOWN' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 400)
  assert.equal((await shipment.POST(request('POST', { action: 'SHIP', carrier: '快递', trackingNumber: 'TRACK-1' }), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))).status, 200)
  assert.deepEqual(calls.shipment, [{ activityId: 'activity-one', winnerId: 'winner-one', actorId: 'admin', action: 'SHIP', carrier: '快递', trackingNumber: 'TRACK-1' }])
})

test('lottery and PII service failures use controlled 5xx responses without raw error details', async () => {
  viewer = 'admin'; manage = true; serviceFailure = 'lottery'
  let result = await adminLottery.GET(request(), defaultContext)
  assert.equal(result.status, 503)
  let body = await responseBody(result)
  assert.deepEqual(body, { code: 'LOTTERY_DRAW_FAILED', message: '开奖尚未完成，请稍后重试' })

  viewer = 'owner'; serviceFailure = 'pii'
  result = await ownerAddress.GET(request(), makeContext({ activityId: 'activity-one', winnerId: 'winner-one' }))
  assert.equal(result.status, 503)
  body = await responseBody(result)
  assert.equal(body.code, 'TOPIC_LOTTERY_PII_KEY_UNAVAILABLE')
  assert.equal(body.message, '抽奖收件加密密钥未配置')

  viewer = 'admin'; manage = true; serviceFailure = 'unknown'
  result = await adminLottery.GET(request(), defaultContext)
  assert.equal(result.status, 500)
  body = await responseBody(result)
  assert.equal(body.code, 'TOPIC_V2_OPERATION_FAILED')
  assert.equal(body.message, '操作失败，请稍后重试')
  assert.doesNotMatch(JSON.stringify(body), /raw-secret-database-detail/u)
})
