import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('个人徽章详情脱离侧栏 stacking context 并使用统一对话框层级', () => {
  const displayName = read('components/UserDisplayName.tsx')
  const profileSummary = read('components/UserProfileSummary.tsx')
  const css = read('app/globals.css')

  assert.match(displayName, /import \{ createPortal \} from 'react-dom'/)
  assert.match(displayName, /createPortal\(content, document\.body\)/)
  assert.match(displayName, /className="badge-detail-backdrop"[\s\S]*event\.stopPropagation\(\); onClose\(\)/)
  assert.match(displayName, /className="badge-detail-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/)
  assert.match(profileSummary, /<UserDisplayName name=\{name\} uid=\{user\.uid\} badges=\{user\.equippedBadges\} badge=\{user\.equippedBadge\} compact/)
  assert.match(css, /--layer-overlay:\s*90/)
  assert.match(css, /--layer-dialog:\s*120/)
  assert.match(css, /--layer-mobile-nav:\s*99999/)
  assert.match(css, /\.badge-detail-backdrop \{[^}]*position:fixed;[^}]*inset:0;[^}]*z-index:var\(--layer-dialog\)/)
  assert.match(css, /@media \(max-width:767px\) \{\s*\.badge-detail-backdrop \{[^}]*z-index:calc\(var\(--layer-mobile-nav\) \+ 1\)/)
  assert.match(css, /\.badge-detail-dialog \{[^}]*max-height:calc\(100dvh - env\(safe-area-inset-top,0px\) - env\(safe-area-inset-bottom,0px\) - 24px\);[^}]*overflow-x:hidden;[^}]*overflow-y:auto/)
  assert.match(css, /\.app-sidebar \{[^}]*z-index:60/)
  assert.doesNotMatch(css, /\.app-sidebar \{[^}]*z-index:var\(--layer-dialog\)/)
})
