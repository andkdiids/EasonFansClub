# Mobile Server RC V1 API Matrix

Reference Mobile revision: `integration/mobile-unified-v2` at `48656d8fe04586bff196ac840cd0e282a363b735`.

The RC integrates these source commits, each based on `origin/main` `1a0c8b9d85c7aa61f5a70e37bcdee563b5bff063`:

- Profile API: `bb34866f92712475d6643c975ca370469d7c25f2`
- Account Security: `87376d4419850a91ee75de032dd718c79803193c`
- Topic Activity V2: `f3b2f400e71e3923f9ca97ff4c6e50daabeeb0fd`

## Profile

| Mobile operation | Method and endpoint | Authentication | RC contract |
| --- | --- | --- | --- |
| Current profile and profile edit | `GET/PATCH /api/users/me` | Bearer or Web Cookie | Present |
| User lookup | `GET /api/friends/list?q=<public-uid>` | Bearer or Web Cookie | Present |
| Public profile modules, including posts, badges, favorites | `GET /api/users/:uid/public-modules?module=...` | Public with optional Bearer/Cookie identity | Present; module privacy is enforced server-side |
| Badge details and equipped badges | `GET /api/users/me/badges`, `GET /api/users/:uid/badges`, `GET /api/users/me/badges/:badgeId` | Bearer or Web Cookie | Present |
| Public post collections | `GET /api/users/:uid/post-groups` | Public with optional Bearer/Cookie identity | Present; visibility and owner rules are enforced server-side |
| View history | `GET/POST /api/profile/view-history` | Bearer or Web Cookie | Present; owner-scoped |
| Profile privacy | `GET/PATCH /api/settings/privacy` | Bearer or Web Cookie | Present; includes `showFavorites` |
| Relationship and message eligibility | `GET /api/users/:userId/relationship` | Bearer or Web Cookie | Present; returns relationship state and `canMessage` |
| Followers / following | `GET /api/users/:userId/followers`, `GET /api/users/:userId/following` | Bearer or Web Cookie | Present; paginated; hidden when viewer and profile owner have a block |
| Follow / unfollow | `POST/DELETE /api/users/:userId/follow` | Bearer or Web Cookie | Present |
| Private collection management | `POST /api/profile/post-groups`, `PATCH/DELETE /api/profile/post-groups/:groupId`, `PATCH /api/posts/:postId/profile-group` | Bearer or Web Cookie | Present; owner-scoped |
| Avatar/background upload | `POST /api/uploads/profile-image` | Bearer or Web Cookie | Present |
| Friend removal | `DELETE /api/friends/:userId` | Bearer or Web Cookie | Present |

The favorites module is controlled by `showFavorites` and the Native Profile privacy screen offers explicit public/private choices. The RC retains the candidate's established public-by-default privacy settings.

## Account Security

| Mobile operation | Method and endpoint | Authentication | RC contract |
| --- | --- | --- | --- |
| Start recovery challenge | `POST /api/auth/forgot-password/security/questions` | Anonymous; no access token | Present |
| Verify recovery answer | `POST /api/auth/forgot-password/security/verify` | Anonymous staged challenge | Present; rate limited |
| Reset password | `POST /api/auth/forgot-password/reset` | Single-use recovery token | Present |
| Read account security status | `GET /api/account/security` | Bearer or Web Cookie | Present |
| Change password | `POST /api/account/security/password/change` | Bearer or Web Cookie | Present; invalidates Mobile sessions |
| Set / update security question | `POST/PUT /api/account/security/questions` | Bearer or Web Cookie | Present; current password required for update |

Recovery responses do not return security answers or hashes. Email password recovery remains disabled. Direct account-security Bearer methods are explicitly passed by middleware to the shared route guard.

## Topic Activity

| Mobile operation | Method and endpoint | Authentication | RC contract |
| --- | --- | --- | --- |
| Browse / detail | `GET /api/activities?type=TOPIC_ACTIVITY...`, `GET /api/activities/:activityId` | Public reads with optional Bearer/Cookie identity | Present |
| V1 form schema and submission history | `GET /api/activities/:activityId/form`, `GET /api/activities/:activityId/my-form-submissions`, `GET /api/topic-activity-form-submissions/:submissionId` | Protected reads; Bearer or Web Cookie | Present |
| Submit V1 form and proof image | `POST /api/activities/:activityId/form-submissions`, `POST /api/uploads/topic-activity-image` | Bearer or Web Cookie | Present |
| My activity participation | `GET /api/activities/me/topic-participations` | Bearer or Web Cookie | Present; includes submissions, polls, tests, and grants |
| V2 program and task history | `GET /api/activities/:activityId/v2`, `GET /api/activities/:activityId/v2/tasks` | Public program read; private task read uses Bearer or Web Cookie | Present; private assets use signed URLs |
| Submit V2 platform task / claim fixed reward | `POST /api/activities/:activityId/v2/tasks`, `POST /api/activities/:activityId/v2/fixed-reward` | Bearer or Web Cookie | Present; Server remains reward authority |
| Poll and test | `GET/POST /api/activities/:activityId/v2/poll`, `POST /api/activities/:activityId/v2/test`, `GET /api/activities/:activityId/v2/attempts` | Public configuration read where supported; mutations/history use Bearer or Web Cookie | Present |
| Lottery and owner fulfillment address | `GET /api/activities/:activityId/v2/lottery`, `GET/PUT /api/activities/:activityId/v2/lottery/winners/:winnerId/address` | Public lottery read; owner address uses Bearer or Web Cookie | Present; address is owner-scoped and requires consent |

## Shared Authentication Contract

Protected Profile, Account Security, and Topic Activity handlers use `requireRequestUser` from `lib/security.ts`. Optional-public reads use `resolveRequestAuth` where the existing contract permits anonymous access.

- An `Authorization` header selects the Bearer path exclusively. Malformed, invalid, expired, or revoked Bearer tokens fail closed and do not fall back to Cookie identity.
- When no `Authorization` header is present, Web requests may use the existing Cookie session.
- `middleware.ts` only passes method/path allowlisted Bearer requests to the route guard. The Account Security allowlist covers its exact GET, PATCH, POST, and PUT routes; unsupported methods remain closed.
- Mobile reward clients cannot directly grant points or badges. Topic Activity writes and duplicate protection remain server-authoritative.

## Database

Only the Profile candidate adds schema and migration changes: `UserPrivacySetting.showFavorites` and `ProfilePostViewHistory`. The migration adds one column and one table, indexes, and cascading foreign keys; it has no `DROP`, `TRUNCATE`, data rewrite, or destructive conversion. The migration is not applied by this RC task.
