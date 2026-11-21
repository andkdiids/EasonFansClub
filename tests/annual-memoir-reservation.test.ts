import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync('prisma/migrations/20261121120000_add_annual_memoir/migration.sql', 'utf8')
const service = readFileSync('lib/annual-memoir-reservation.ts', 'utf8')
const route = readFileSync('app/api/activities/[activityId]/annual-memoir/reservation/route.ts', 'utf8')

test('migration enforces reservation and report uniqueness and keeps configuration disabled', () => {
  assert.match(sql, /UNIQUE INDEX .*AnnualMemoirReservation_activityId_userId_key/)
  assert.match(sql, /UNIQUE INDEX .*AnnualMemoirSnapshot_userId_year_key/)
  assert.match(sql, /enabled.*DEFAULT false/i)
})

test('reservation freezes awards and uses separate locked transactions for fulfillment', () => {
  assert.match(service, /points: config.reservationPoints, badgeId: config.reservationBadgeId/)
  assert.match(service, /FROM AnnualMemoirReservation WHERE id = .* FOR UPDATE/)
  assert.match(service, /if \(!result\?\.created\) return/)
  assert.match(service, /annual-memoir-reservation-points:/)
  assert.match(service, /annual-memoir-reservation-badge:/)
})

test('reservation endpoint is scoped to the session and exposes no cancellation', () => {
  assert.match(route, /reserveMemoir\(\(await params\).activityId, user.id\)/)
  assert.match(route, /body\?\.confirmed !== true/)
  assert.doesNotMatch(route, /export async function DELETE/)
})
