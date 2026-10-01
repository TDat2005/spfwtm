-- AlterTable
ALTER TABLE `shops`
  ADD COLUMN `catalogSyncId` VARCHAR(36) NULL,
  ADD COLUMN `catalogSyncStatus` ENUM('IDLE', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'IDLE',
  ADD COLUMN `catalogSyncPage` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `catalogSyncedCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `catalogSyncError` TEXT NULL,
  ADD COLUMN `catalogSyncStartedAt` DATETIME(3) NULL,
  ADD COLUMN `catalogSyncHeartbeatAt` DATETIME(3) NULL,
  ADD COLUMN `catalogSyncFinishedAt` DATETIME(3) NULL;
