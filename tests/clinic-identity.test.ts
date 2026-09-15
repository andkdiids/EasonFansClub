import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveClinicAuthorIdentity } from '@/lib/clinic-service'

type ResolverInput = Parameters<typeof resolveClinicAuthorIdentity>[0]

function author(id: string, uid: number, nickname: string): ResolverInput['author'] {
  return {
    id,
    uid,
    nickname,
    nicknameModerationStatus: 'VISIBLE',
    avatarUrl: null,
    Profile: null,
    EquippedBadge: null,
  }
}

function resolve(overrides: Partial<ResolverInput> = {}) {
  const input: ResolverInput = {
    recordAuthorId: 'patient-id',
    recordIdentityMode: 'ANONYMOUS',
    recordAnonymousNumber: 1234,
    authorId: 'doctor-id',
    author: author('doctor-id', 2002, '医生'),
    identityMode: 'ANONYMOUS',
    anonymousNumber: 5678,
    ...overrides,
  }
  return resolveClinicAuthorIdentity(input)
}

test('病例作者在匿名病例的主回复和嵌套回复中始终显示为稳定的匿名患者', () => {
  const first = resolve({
    authorId: 'patient-id',
    author: author('patient-id', 1001, '真实患者'),
    identityMode: 'ANONYMOUS',
    anonymousNumber: 9001,
  })
  const nested = resolve({
    authorId: 'patient-id',
    author: author('patient-id', 1001, '真实患者'),
    identityMode: 'PUBLIC',
    anonymousNumber: 9002,
  })

  assert.deepEqual(first, {
    type: 'anonymous',
    displayName: '匿名患者 #1234',
    avatarKind: 'clinic-anonymous',
    canOpenProfile: false,
  })
  assert.deepEqual(nested, first)
  assert.equal(JSON.stringify(first).includes('真实患者'), false)
  assert.equal(JSON.stringify(first).includes('1001'), false)
})

test('会诊者仍按自己的会诊身份显示，不继承病例作者角色', () => {
  const anonymousDoctor = resolve()
  assert.deepEqual(anonymousDoctor, {
    type: 'anonymous',
    displayName: '匿名医师 #5678',
    avatarKind: 'clinic-anonymous',
    canOpenProfile: false,
  })

  const publicDoctor = resolve({ identityMode: 'PUBLIC' })
  assert.equal(publicDoctor.type, 'public')
  if (publicDoctor.type === 'public') {
    assert.equal(publicDoctor.displayName, '医生')
    assert.equal(publicDoctor.uid, 2002)
    assert.equal(publicDoctor.profileUrl, '/user/2002')
    assert.equal(publicDoctor.canOpenProfile, true)
  }
})

test('同一用户在自己的病例是患者，在其他病例中是会诊者', () => {
  const ownRecord = resolve({
    recordAuthorId: 'patient-id',
    authorId: 'patient-id',
    author: author('patient-id', 1001, '真实患者'),
  })
  const otherRecord = resolve({
    recordAuthorId: 'another-patient-id',
    authorId: 'patient-id',
    author: author('patient-id', 1001, '真实患者'),
    anonymousNumber: 7654,
  })

  assert.equal(ownRecord.type, 'anonymous')
  assert.equal(ownRecord.displayName, '匿名患者 #1234')
  assert.equal(otherRecord.type, 'anonymous')
  assert.equal(otherRecord.displayName, '匿名医师 #7654')
})

test('历史上错误保存的病例作者 identityMode 仍按 ClinicRecord.authorId 兼容为患者', () => {
  const identity = resolve({
    authorId: 'patient-id',
    author: author('patient-id', 1001, '真实患者'),
    identityMode: 'ANONYMOUS',
    anonymousNumber: 9999,
  })

  assert.equal(identity.type, 'anonymous')
  assert.equal(identity.displayName, '匿名患者 #1234')
})
