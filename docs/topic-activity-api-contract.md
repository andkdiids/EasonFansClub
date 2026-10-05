# Topic Activity API Contract (V1)

Server is authoritative for both Web and Mobile. Web uses the existing
cookie session; Mobile uses the existing Bearer access-token middleware and
request-user resolver.

## Activity list and detail

- `GET /api/activities?type=TOPIC_ACTIVITY` retains the existing activity
  list envelope and `ActivityView`; topic fields are additive:
  `pinToPlaza`, `activityPostId`, `participationRule`, `rewardGrantMode`,
  `rewardGrantAt`, `rewardPoints`, and the public aggregate `rewardBadgeCount`.
- `GET /api/activities/:activityId` retains the existing detail envelope and
  includes the same additive fields. Public responses never expose internal
  badge IDs. `activityPostId` is the single canonical discussion post.
- `GET /api/activities/me/topic-participations?page=1&pageSize=20` returns
  `{ participations, page, pageSize, total, hasMore }`. Each row aggregates
  comments by activity and includes `submissionCount`,
  `approvedSubmissionCount`, resolved `status`, `countedInActivity`,
  `rewardStatus`, and an activity summary.

## Participation by comment

- `POST /api/posts/:postId/replies` remains the only submission-creation
  operation. A root comment on a published topic activity's canonical post,
  by a non-admin while `startsAt <= now <= endsAt`, creates one `PENDING`
  submission in the same transaction. Replies, out-of-window comments, and
  comments on other posts do not.
- `GET /api/posts/:postId/replies` retains pagination and sorting. Only the
  comment author and `activity_manage` admins receive
  `topicActivitySubmission: { id, status, rejectReason, alreadyCounted }`.

## Inline moderation

- `PATCH /api/admin/topic-activity-submissions/:submissionId` accepts
  `{ status: "APPROVED" | "REJECTED", rejectReason?: string }`. It requires
  `activity_manage`, verifies the Activity/canonical-post relation, and
  returns the updated submission and aggregate participation. Repeated review
  requests are idempotent.
- The handler supports Cookie and Mobile Bearer auth. Clients cannot submit an
  arbitrary comment ID to create or review a submission.

## Reward dispatch

Approval creates at most one participation per activity/user. Reward
eligibility and per-kind grants are persisted server-side. Immediate grants
are dispatched after the review transaction; scheduled grants are dispatched
by the existing authenticated activity internal job when due. Points use a
unique `PointLog.businessKey`; badges use the existing
`grantBadgeWithTransaction` service and a stable grant key.
