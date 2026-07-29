import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('tour cover upload survives save and remains available to the tour list', () => {
  const manager = read('app/admin/music/tours/AdminTourManager.tsx')
  const createRoute = read('app/api/admin/music/tours/route.ts')
  const updateRoute = read('app/api/admin/music/tours/[tourId]/route.ts')
  const schema = read('prisma/schema.prisma')

  assert.match(manager, /type TourForm = \{[\s\S]*coverUrl: string/)
  assert.match(manager, /coverUrl: tour\.posterUrl \|\| ''/)
  assert.match(
    manager,
    /onUploaded=\{\(url\) => \{[\s\S]*setForm\(\(current\) => \(\{ \.\.\.current, coverUrl: url \}\)\)/,
  )
  assert.match(manager, /body: JSON\.stringify\(form\)/)
  assert.match(manager, /tour\.posterUrl \? <Image/)

  assert.match(
    createRoute,
    /posterUrl: sanitizeText\(body\?\.coverUrl \?\? body\?\.posterUrl, 1000\) \|\| null/,
  )
  assert.match(updateRoute, /'coverUrl' in body \|\| 'posterUrl' in body/)
  assert.match(updateRoute, /\.\.\.\(hasCoverUrl \? \{ posterUrl \} : \{\}\)/)
  assert.match(schema, /model MusicTour \{[\s\S]*posterUrl\s+String\?\s+@db\.Text/)
})
