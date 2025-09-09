-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `buyerId` VARCHAR(191) NOT NULL,
    `listingId` VARCHAR(191) NULL,
    `type` VARCHAR(32) NOT NULL,
    `quantity` INTEGER NULL,
    `year` INTEGER NULL,
    `amountEur` DECIMAL(10, 2) NOT NULL,
    `applicationFeeEur` DECIMAL(10, 2) NULL,
    `stripeSessionId` VARCHAR(191) NULL,
    `stripePaymentIntent` VARCHAR(191) NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
