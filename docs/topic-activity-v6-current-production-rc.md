# Topic V6 current-production integration RC

## Scope and release boundary

- Production base: `8e1c3dbe7f0b90e375d0c43362df087564dce24d`.
- Source V6 commit: `3a670d4ab9dc421e5c23752daa50ac7d6ab75572`.
- Branch: `release/topic-activity-v6-current`.
- Source commit was ported with `git cherry-pick --no-commit`; no conflicts occurred.
- This is an integration RC only. Deployment, production writes, migration execution, Mobile changes and APK builds are not authorized by this task.
- The older `topic-activity-hotfix-v6.md` documents the original 170-migration source RC. Its release-order hold is historical; this RC now includes Cantonese Progress migration 171 but still requires separate release approval.

## Preservation audit

All 37 non-overlapping source V6 files were initially identical to the source commit. Shared `middleware.ts` retains the production progress GET/POST routes and adds only the two authenticated original-download GET patterns. Shared `tests/topic-activity-hotfix-v4.test.ts` retains the production Topic-schema preservation guard and uses the new controlled dialog assertion.

The only additional test correction normalizes LF/CRLF before comparing Git schema text with the Windows checkout. It does not normalize other whitespace, weaken model/relationship assertions, or change the schema.

The seven non-overlapping Cantonese Progress files are unchanged from the production base. `prisma/` is unchanged in its entirety: schema, migration 171, historical migrations and baseline metadata. Base and candidate each contain 171 migrations; no migration was created or edited.

## FORM REQUIRED BEFORE COMMENT

Implementation:

- `lib/topic-activity.ts`: `isTopicActivityFormRequired` and `resolveTopicActivityCommentEligibilityInTransaction` resolve FORM/BOTH requirements, all valid submissions, durable administrator unlock and lifetime SINGLE history.
- `lib/topic-activity-comment-policy.ts`: lifecycle precedes form, administrator reply and SINGLE checks; old config defaults remain compatible.
- `app/api/posts/[postId]/replies/route.ts`: Activity → Post → User locking and the eligibility check run before `reply.create`; only canonical root comments use this gate. There is no administrator participant exemption or automatic historical-comment deletion.
- `app/api/admin/topic-activity-form-submissions/[submissionId]/replies/route.ts`: administrator text/image replies persist the durable unlock in the existing snapshot JSON. Deleting the reply does not revoke an earned unlock.

Executed tests (PASS):

- `direct POST gate matrix enforces form, admin reply, activity lifecycle, and admin participant rules`
- `direct POST keeps nested replies ordinary and does not gate COMMENT activities with legacy form fields`
- `actual eligibility query preserves lifetime history and unlocks from any valid submitted form`
- `direct admin text/image replies persist durable unlock and deletion does not re-lock`

SINGLE remains enforced against all historical participation submissions, including deleted, withdrawn and hard-deleted comments. The existing lock contract is retained. `direct SINGLE POST uses lifetime submission history and remains concurrency-safe` passed using serialized transaction fixtures; no live MySQL concurrency test was performed.

## REVIEW CONFIRM MODAL

Implementation:

- `components/activities/ReviewConfirmDialog.tsx`: controlled approve/reject dialog; fixed `确认通过` / `确认拒绝`, explicit `type="button"`, pending disable, error display, reject-reason preservation and focus management.
- `components/PostRepliesSection.tsx`: one review flow with an immediate in-flight guard; success refreshes locally, failure keeps the page/dialog open. The approval/rejection path does not call native browser confirmation, `window.close` or `history.back`.
- `components/ReplyForm.tsx`, `components/PostReplyBottomSheet.tsx`, `components/activities/SingleCommentConfirmDialog.tsx`: SINGLE `beforeSubmit` confirmation applies to button and keyboard submission, not nested replies. Cancel sends no request; confirm sends one.

Executed tests (PASS):

- `V6 UI consumes the canonical DTO and fails closed for incomplete eligibility`
- `V6 comment UI refreshes eligibility, opens the form through the canonical event, and guards SINGLE submission`
- `V6 review and SINGLE dialogs are controlled, explicit button actions`
- `V6 browser fixtures: real ReplyForm SINGLE confirmation, keyboard boundary, and review API error`

Browser fixtures exercised desktop keyboard input, Chromium/Edge with an Android user agent/viewport, and Playwright WebKit with an iPhone user agent/viewport. They cover approve/reject labels, API-error retention and duplicate activation. Physical Android WebView and real iOS Safari/device QA remain PENDING. The reported device-specific native `关闭网页` label was not reproduced; its precise native mapping is not claimed as proven.

## Images, download security and V5 semantics

The original upload code, preview/original separation, owner/authorized-admin stream routes and activity/submission/reply/asset relation checks are preserved from Source V6.

Executed media tests (PASS) include:

- `upload handler stores the exact original bytes and separate private previews`
- `authenticated original download streams byte-identical owner/admin data`
- `form-answer original download streams byte-identical owner/admin data`
- `original download denies anonymous/other user and every wrong relation before COS access`
- `form-answer original download denies anonymous/other user and every wrong relation before COS access`
- `large 4500x3000 source above forum threshold is stored byte-for-byte with original dimensions`

PNG/JPEG/WEBP upload-to-download hashes matched. No genuine HEIC fixture was available; real HEIC validation remains pending. Legacy compressed V5 bytes are not retrospectively recoverable.

Forms remain information collection/reply-only. Approved, undeleted root comments alone drive participation, rewards and counts. Existing reward locks, grant keys and point-log idempotency are unchanged. Topic V5 and reward regression tests passed, including `审核事务以活动行锁串行化，日志、聚合、单次奖励资格和回滚保护均在服务端` and `奖励通知只在真实 GRANTED 时写到账金额，定时 job 发放后有幂等到账通知`.

## Cantonese Progress

Preserved implementation:

- `prisma/schema.prisma`: `CantoneseLessonProgress` and unique user/lesson key.
- `prisma/migrations/20261006100000_add_cantonese_lesson_progress/migration.sql`.
- `app/api/learning/cantonese/progress/route.ts` and `progress/[lessonId]/route.ts`.
- `lib/cantonese-progress.ts`: Server-owned prerequisites, readiness, monotonic completion, four actions, idempotent NULL-guarded timestamps and bounded conflict retries.
- Existing request guards and middleware retain Web Cookie and Mobile Bearer behavior.

Executed tests (PASS) include:

- `actual Mobile Bearer GET uses explicit prerequisites and own user; L05 pending stays NOT_RELEASED`
- `actual Mobile Bearer POST START ignores forged body userId and never changes another user`
- `Web Cookie request guard fixture supports progress GET and POST without Bearer`
- `all four route actions and duplicates are idempotent with stable first timestamps`
- `concurrent START retries the unique-key upsert race: two successes, one row, one first timestamp`
- `concurrent COMPLETE preserves one row and first completion timestamp without a 500`
- `Mobile Bearer middleware opens only progress GET and lesson POST routes`

These authentication and persistence tests use local fixtures and ephemeral test credentials, never production sessions or data.

## Executed regression evidence

- Topic/middleware directed: 92 tests; 90 passed, 0 failed, 2 opt-in browser tests skipped.
- Explicit V5/V6 browser run: 2 passed, 0 failed, 0 skipped.
- Cantonese directed (including Progress, Admin and Jyutping): 125 passed, 0 failed, 0 skipped.
- Full base: 3,732 tests; 3,714 passed, 17 failed, 1 skipped.
- Full candidate: 3,759 tests; 3,741 passed, 16 failed, 2 skipped.
- New failure names: 0. The only resolved baseline failure is the Windows LF/CRLF schema comparison; the other 16 unrelated baseline failures remain visible.
- Prisma validate/generate passed. The generated client includes `CantoneseLessonProgress`.
- TypeScript passed. Final full-repository lint passed with 0 errors and 128 existing warnings. Production build passed.
- Migration/frozen-file audit, diff check and sensitive scan passed; no sensitive values were printed.

Production write: 0. Migration executed: NO. Deploy: NO. APK: NO. Next: wait for separate release approval.
