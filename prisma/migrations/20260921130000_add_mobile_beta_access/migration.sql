-- Additive Android beta access storage.
-- Invite codes and credentials are represented only by SHA-256 hashes.
CREATE TABLE `BetaInviteCode` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `codePrefix` VARCHAR(16) NOT NULL,
    `maskedCode` VARCHAR(32) NOT NULL,
    `status` ENUM('ACTIVE', 'USED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `maxActivations` INTEGER NOT NULL DEFAULT 1,
    `activationCount` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `BetaInviteCode_codeHash_key`(`codeHash`),
    INDEX `BetaInviteCode_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `BetaInviteCode_createdById_createdAt_idx`(`createdById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BetaDeviceActivation` (
    `id` VARCHAR(191) NOT NULL,
    `inviteCodeId` VARCHAR(191) NOT NULL,
    `installationIdHash` VARCHAR(64) NOT NULL,
    `credentialHash` VARCHAR(64) NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `activatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastVerifiedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BetaDeviceActivation_credentialHash_key`(`credentialHash`),
    UNIQUE INDEX `BetaDeviceActivation_inviteCodeId_installationIdHash_key`(`inviteCodeId`, `installationIdHash`),
    INDEX `BetaDeviceActivation_installationIdHash_idx`(`installationIdHash`),
    INDEX `BetaDeviceActivation_status_lastVerifiedAt_idx`(`status`, `lastVerifiedAt`),
    INDEX `BetaDeviceActivation_inviteCodeId_activatedAt_idx`(`inviteCodeId`, `activatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BetaInviteCode`
    ADD CONSTRAINT `BetaInviteCode_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BetaDeviceActivation`
    ADD CONSTRAINT `BetaDeviceActivation_inviteCodeId_fkey`
    FOREIGN KEY (`inviteCodeId`) REFERENCES `BetaInviteCode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
