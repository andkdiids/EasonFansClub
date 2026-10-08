# Topic Activity V6.1.1 isolated hotfix audit

## Baseline and safety

- Requested production baseline and candidate HEAD: `635ae4a0e1d8eae9d93420517a17f4b29794896f`.
- Candidate worktree: `C:\Users\Eason\Documents\私家E院\worktrees\ecfc-topic-activity-hotfix-v6-1-1`.
- Candidate branch: `release/topic-activity-hotfix-v6-1-1`.
- Clean comparison worktree: `C:\Users\Eason\Documents\私家E院\worktrees\_topic-v611-baseline`, detached at the same baseline.
- Read-only remote check: `release/topic-activity-hotfix-v6-1` matches the requested baseline. Remote `main` is `1cdaf1dcfec4555532a9f3fe05b6c04373a51884`; it was not treated as production or used as this hotfix base.
- Production health returned 401 without an authenticated session. Deployed SHA is supplied by the user and corroborated by the release ref, not independently reverified by health in this environment.
- No authenticated production read-only database connection was available. Actual incident Comment, Submission, Participation, PointLog and Notification rows remain UNKNOWN. No production data was changed or reward reissued.
- No staging, commit, push, deploy, Mobile source modification or Cantonese source modification. Existing dirty worktrees were not overwritten.

## Issue 1: confirmation layer and content validation

The existing confirmation lived inside the page while the mobile composer and mask were body portals. The mask uses the dialog layer and the sheet uses dialog + 1; the confirmation was lower and could also inherit an ancestor stacking context.

The confirmation now portals to `document.body`, above both dialog and mobile-navigation layers. The underlying sheet is inert while confirming. Escape and browser Back cancel only the top confirmation; the composer and its image state remain mounted. Focus is trapped/restored and visual-viewport height/offset constrain the dialog when the keyboard changes the visible area.

The frontend previously accepted nonempty one-character text while the server required at least two sanitized graphemes. Both now share `replyMinimumContentError` and the existing text normalization. Whitespace-only text is invalid. Existing image-only and sticker-only exceptions remain valid when their relevant permissions permit them. Validation runs before confirmation. Only the existing SINGLE root-comment gate requests this confirmation; ordinary nested replies do not acquire it. The submit ref prevents duplicate requests, and readable errors preserve drafts.

## Issue 2: IMAGE fields and comment attachments

The old flag coupled schema normalization, the field designer and FORM_ANSWER uploads. IMAGE fields are now independently valid/selectable/uploadable. Their own `multiple` and `maxImages` configuration is authoritative; existing three-image fields are not rewritten to one image.

The real form-submit endpoint continues to validate answers and field limits before writes and link only the current user's unused assets for that activity. The frontend uses the same answer validator and rejects an excessive file selection instead of silently truncating it. Tests exercise a forged two-image answer against a one-image field and an existing three-image field with the attachment switch off.

Comment/reply image controls obey the activity flag, and the POST handler rechecks it under the Activity row lock for both roots and nested replies. Disabled attachments reject imageUrls and forged internal image markers before comment creation. Ordinary posts retain their existing attachment behavior. Legacy optional whole-form attachments still use their existing flag; field IMAGE uploads no longer depend on it. Private upload/auth/original-byte download handling is unchanged.

## Issue 3: strict review filters and incremental state

Both page and API queries previously included an OR exception for `authorId == viewerId`. Consequently an administrator's own APPROVED comment could still be returned under PENDING. They now use a shared strict activity/status relation filter. The separate my-comment shortcut remains; it does not override the administrative main-stream filter.

On a successful review, local status/filter/counts change immediately. A private no-store GET synchronizes authoritative counts and refills the current filtered page without a route refresh. ALL is counted from actual visible roots, including historical ordinary comments without a Submission; it is not a sum of the four review statuses. Existing nested branches, expanded state, drafts and visual author metadata are retained for surviving roots. Request sequencing prevents stale synchronization responses overwriting a newer review or navigated filter. Failed reviews stay on the original status with a visible error. Failed read synchronization offers a read-only retry, not an automatic repeat approval.

Reward and notification services are untouched. Tests confirm repeat approval is unchanged/idempotent; review GET has zero reward/notification side effects. Already-approved rows are not automatically reviewed again.

## Verification

Node: 24.18.0. Both worktrees use the same dependency state; package.json and pnpm-lock.yaml SHA256 values match. Prisma client: 6.19.3. DATABASE_URL during tests/build points only to an intentionally unavailable localhost fixture endpoint, never production.

Full A/B command in both worktrees:

```text
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=4 --test-reporter=tap tests/*.test.ts
```

| Result | Baseline | Final candidate |
| --- | ---: | ---: |
| Total | 3771 | 3780 |
| Pass | 3752 | 3760 |
| Fail | 16 | 16 |
| Skip | 3 | 4 |

Failure sets compared by test file + test name: NEW FAILURES = 0; FIXED BASELINE FAILURES = 0. The additional skipped file is opt-in browser QA, run separately successfully. Earlier exploratory runs are not the final A/B evidence.

- Directed: 36 files, 324 pass, 0 fail, 4 opt-in skips.
- Browser fixtures: V5/V6/V6.1/V6.1.1, 13 pass, 0 fail. Real React components and production Tailwind styles run in headless Edge with local fixtures; Android/WeChat UA is not physical WebView QA. Includes click/touch layer hit-testing, short text, cancel/Escape/Back preserving text and uploaded image, double-click protection, errors, IMAGE independence, approve/reject/self-review, authoritative counts, page refill and scroll retention.
- TypeScript: PASS, including final handler fixtures.
- Final full lint: 0 errors, 128 warnings. Changed-file lint: 0 errors, 6 existing warnings.
- Prisma validate and isolated dependency-client generate: PASS. No database migration executed.
- Migration static check: PASS, 21 legacy migrations skipped + 150 MySQL-native migrations checked. Repo directories: 171, identical to baseline; schema/migration diff empty. No DROP, RENAME or destructive change introduced.
- Final production build: PASS (exit 0), Next.js 15.5.20, 122 static pages generated. Chunk circular-dependency and lint warnings remain reported; this hotfix does not suppress them.
- Diff check: PASS.
- Credential-pattern scan: 0 matches across 22 changed files including this report; final scan repeated before handoff.

Evidence logs are under `C:\Users\Eason\Documents\私家E院\tmp\`: `topic-v611-base-stable.tap`, `topic-v611-candidate-closure.tap`, `topic-v611-directed-final-state.tap`, `topic-v611-browser-final-state.tap`, `topic-v611-typecheck-final-state.log`, `topic-v611-lint-final-state.log`, `topic-v611-changed-lint.log`, `topic-v611-prisma-generate.log`, `topic-v611-build-final-state.log`.

Baseline's 16 failures remain in badge-effects, birthday-first-set-flow, forum-discovery, friend-chat-sticker-focus (2), friend-display-name, friend-list-scroll-restoration (3), navigation-notification-profile-card (2), post-badge-display, production-incremental-candidate (3: missing tmp SQL fixture), and want-listen-availability. They were not repaired in this hotfix.

## Files

Runtime (13):

- app/api/posts/[postId]/replies/route.ts
- app/api/uploads/topic-activity-image/route.ts
- app/posts/[postId]/page.tsx
- components/PostRepliesSection.tsx
- components/PostReplyBottomSheet.tsx
- components/ReplyForm.tsx
- components/activities/SingleCommentConfirmDialog.tsx
- components/activities/TopicActivityFormDesigner.tsx
- components/activities/TopicActivityFormParticipation.tsx
- components/activities/TopicActivityImagePicker.tsx
- lib/reply-length.ts
- lib/topic-activity-form.ts
- lib/topic-review-filter.ts (new)

Tests (8):

- tests/post-detail-comment-composer.test.ts
- tests/post-replies-pinning-sorting.test.ts
- tests/topic-activity-form.test.ts
- tests/topic-activity-v6-comment-route.test.ts
- tests/topic-activity-v6-media.test.ts
- tests/topic-activity-v61-form-submit.test.ts
- tests/topic-activity-v611.test.ts (new)
- tests/topic-activity-v611-browser.test.ts (new)

Report (1): docs/topic-activity-v6-1-1-hotfix-audit.md (new).

## Physical QA and handoff

Android WeChat REAL DEVICE: PENDING. iOS Safari REAL DEVICE: PENDING. No physical result is inferred from the UA simulation.

Please manually check the real keyboard/confirmation interaction, cancel/Back preserving images, short-text feedback, attachment-off + IMAGE-on, one-image field excess rejection, and administrator self-approval/rejection moving between filters without losing the expanded discussion. Read-only production incident records still require an authorized diagnostic connection if their exact persisted state must be confirmed.

No commit/push/deploy is authorized in this task. Wait for the user's review.
