-- Add the per-rule retention policy for AUTO badges.
--
-- The column is NULLABLE on purpose. NULL means "inherit the rule-type
-- default", which is resolved in lib/badge-retention.ts:
--   * every rule type  -> PERMANENT_AFTER_GRANT (preserves today's behaviour)
--   * BADGE_OWNERSHIP  -> RETAIN_WHILE_ELIGIBLE (it already revokes when the
--                         prerequisite set stops matching, so its current
--                         behaviour must be preserved, not changed)
-- That keeps existing rows on their current semantics with no data rewrite,
-- and a NULL-only ADD COLUMN is a cheap metadata-only DDL on MySQL 8.
--
-- This migration is intentionally not executed in this change.

ALTER TABLE `BadgeRule`
  ADD COLUMN `retentionPolicy` ENUM('PERMANENT_AFTER_GRANT', 'RETAIN_WHILE_ELIGIBLE') NULL;
