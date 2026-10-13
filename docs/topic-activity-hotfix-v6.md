# Topic Activity V6 release boundary

This RC is based on `71833bbc0fa1bc89f893bd5848f654fe74d10f2f` (170 migrations). It must **not be deployed directly**. Cantonese Progress must deploy migration 171 first; then selectively port V6 onto that production SHA and verify both features before a separately authorized deployment.

## Comment policy

`Activity.formSchema.commentPolicy` uses the existing JSON field. Missing policy resolves to `AFTER_FORM_SUBMIT` and `MULTIPLE`. Enabled FORM/BOTH activities require a submitted form for canonical root participation comments. `AFTER_ADMIN_REPLY` additionally requires a qualifying administrator text/image reply. Nested replies retain ordinary forum rules. Administrators participating as users have no exemption.

The form snapshot records a server-owned, durable administrator-reply unlock. Once unlocked, deleting a reply does not revoke eligibility. This marker is independent of form review status: forms only collect information and receive replies, never create participation, rewards or activity counts.

SINGLE checks all historical participation submissions, including withdrawn/deleted comments, under the existing comment transaction locks. Sending consumes the opportunity; cancellation of the client confirmation sends no request. Approved comments remain the sole authoritative source of activity participation and rewards.

## Private originals

Topic form/reply upload is separate from forum compression. The original image bytes are kept privately; display previews are independent derivatives. Oversized originals are explicitly rejected rather than silently compressed. Original downloads use authenticated relationship checks (activity, submission, reply and asset) and owner/authorized-administrator access. Filenames are sanitized; no public permanent source URL is introduced.

Existing V5 image assets cannot regain bytes that the old upload path discarded. Original-quality guarantees apply to newly uploaded V6 originals, not retroactive reconstruction of compressed assets.

## Review confirmation

Comment approval/rejection uses one controlled dialog with explicit `type="button"` actions, fixed Chinese labels, pending guards and in-dialog errors. It does not delegate review confirmation to the browser or close the page. Local fixture/browser results are not physical Android WebView or iOS Safari certification.

The previous review path used native `window.confirm`/`window.prompt`; their controls belong to the browser/WebView rather than the application's buttons. No `window.close` or `history.back` review action was found. The reported device-specific “关闭网页” label was not reproduced locally, so its precise browser mapping is not claimed as proven. Removing the native review path gives the application direct ownership of the confirmation labels and actions.

## Data safety

No schema, migration, baseline, production configuration or deployment change is part of this RC. All verification is local fixtures; no production forms, replies, comments, reviews, downloads or rewards are used as test data. Mobile and Cantonese Progress worktrees are outside this task.

## Verification evidence

- Full baseline: 3,706 tests; 3,689 passed, 16 failed, 1 skipped.
- Full candidate: 3,733 tests; 3,715 passed, the same 16 failed, 2 skipped. New failure names: 0. Existing unrelated failures were not hidden or repaired by this change.
- Topic activity and middleware directed suite: 92 tests; 90 passed, 0 failed, 2 opt-in browser tests skipped. The two browser tests were then explicitly enabled and both passed.
- Local browser fixtures exercised Chromium with an Android viewport/user agent, WebKit with an iPhone viewport/user agent, and desktop keyboard submission. These are engine simulations, not physical Android WebView or iOS Safari QA.
- PNG/JPEG/WEBP upload-to-private-download hashes matched. A real high-detail 4,500 × 3,000 JPEG larger than 4 MB retained its dimensions, size and hash. No genuine HEIC fixture was available; HEIC device validation remains pending.
- SINGLE concurrency was verified through serialized transaction fixtures and the existing database lock contract. This was not a live MySQL concurrency test.
- TypeScript, lint (0 errors; 128 existing warnings), Prisma validate/generate, production build, diff check and sensitive scan passed.

This evidence prepares the RC for review only. It does not remove the migration-171 release-order hold or authorize production deployment.
