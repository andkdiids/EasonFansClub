import assert from 'node:assert/strict'
import Module from 'node:module'
import { after, before, test } from 'node:test'

const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const originalLoader = loader._load
let route: typeof import('@/app/api/admin/badges/route')
type AdminRecord = Record<string, unknown>
type FakeBadgeTransaction = {
  badge: {
    create: (input: { data: AdminRecord; select?: unknown }) => Promise<AdminRecord>
    findUniqueOrThrow: (input?: unknown) => Promise<AdminRecord>
  }
  badgeRule: {
    create: (input: { data: AdminRecord }) => Promise<AdminRecord>
  }
}
type FakeAdminPrisma = {
  activity: {
    findUnique: (input?: unknown) => Promise<AdminRecord>
  }
  $transaction: <T>(callback: (tx: FakeBadgeTransaction) => Promise<T>) => Promise<T>
}
let storedBadge: AdminRecord | null = null
let storedRule: AdminRecord | null = null

function adminBadge(): AdminRecord | null {
  if (!storedBadge) return null
  return {
    ...storedBadge,
    BadgeRule: storedRule,
    _count: { UserBadge: 0 },
  }
}

const fakePrisma: FakeAdminPrisma = {
  activity: {
    findUnique: async () => ({ id: 'activity-none', title: '无需核销活动', status: 'PUBLISHED', verificationMode: 'NONE' }),
  },
  $transaction: async <T>(callback: (tx: FakeBadgeTransaction) => Promise<T>) => callback({
    badge: {
      create: async ({ data }: { data: AdminRecord }) => {
        storedBadge = { ...data }
        return { id: data.id, name: data.name, code: data.code }
      },
      findUniqueOrThrow: async () => adminBadge() || {},
    },
    badgeRule: {
      create: async ({ data }: { data: AdminRecord }) => {
        storedRule = { id: 'rule-none', ...data }
        return storedRule || {}
      },
    },
  }),
}

before(async () => {
  loader._load = function (request, parent, main) {
    if (request === '@/lib/prisma') return { prisma: fakePrisma }
    if (request === '@/lib/security') return {
      requireAdmin: async () => ({ user: { id: 'admin-one' } }),
      sanitizeText: (value: unknown, maxLength: number) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '',
    }
    if (request === '@/lib/media-url') return {
      toPublicMediaUrl: (value: string | null) => value,
      toStoredMediaUrl: (value: string | null) => value,
    }
    if (request === '@/lib/badge-phase2') return {
      getBadgeAvailability: () => 'PERMANENT',
      getBadgeOwnershipStats: async () => new Map(),
      parseBadgeAvailabilityDate: () => ({ value: null }),
      validateBadgeAvailability: () => null,
    }
    if (request === '@/lib/badge-service') return {
      badgeAdminSelect: {},
      listBadgesForAdmin: async () => {
        const badge = adminBadge()
        return badge ? [badge] : []
      },
      writeBadgeAdminAction: async () => undefined,
    }
    if (request === '@/lib/badge-ownership') return {
      syncBadgeOwnershipDependencies: async () => undefined,
      validateBadgeOwnershipRule: async ({ config }: { config: unknown }) => ({ config }),
    }
    if (request === '@/lib/badge-ownership-config') return { getBadgeOwnershipRuleConfig: () => null }
    return originalLoader.call(this, request, parent, main)
  }
  route = await import('@/app/api/admin/badges/route')
})

after(() => { loader._load = originalLoader })

test('后台 API 保存并回读 NONE 活动参与规则，不要求核销字段', async () => {
  const response = await route.POST(new Request('http://localhost/api/admin/badges', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '无需核销活动徽章',
      grantType: 'AUTO',
      rule: {
        ruleType: 'ACTIVITY_PARTICIPATION',
        operator: 'GTE',
        threshold: null,
        configJson: { activityId: 'activity-none' },
        isEnabled: true,
        retentionPolicy: null,
        sustainedQualification: false,
        inactiveAfterDays: null,
        revokeAfterDays: null,
      },
    }),
  }))
  assert.equal(response.status, 201)
  const saved = await response.json() as { badge?: { rule?: { configJson?: unknown } } }
  assert.deepEqual(saved.badge?.rule?.configJson, { activityId: 'activity-none' })

  const reload = await route.GET(new Request('http://localhost/api/admin/badges?grantType=AUTO'))
  assert.equal(reload.status, 200)
  const reloaded = await reload.json() as { badges?: Array<{ rule?: { ruleType?: string; configJson?: unknown } }> }
  assert.equal(reloaded.badges?.[0]?.rule?.ruleType, 'ACTIVITY_PARTICIPATION')
  assert.deepEqual(reloaded.badges?.[0]?.rule?.configJson, { activityId: 'activity-none' })
})
