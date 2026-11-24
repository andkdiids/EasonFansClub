-- Admin-only match-source audit for the two-stage target lottery.
-- Additive only: both columns are new, `friendHit` is defaulted and
-- `victimTier` is nullable, so no historical Shun round, ledger entry or
-- registration-fee flow is rewritten.
ALTER TABLE `ShunMasterRound`
    ADD COLUMN `friendHit` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `victimTier` INTEGER NULL;
