-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FridaySettings` (
    `id` INTEGER NOT NULL,
    `currentPriceEur` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FridayToken` (
    `id` VARCHAR(191) NOT NULL,
    `issuedYear` INTEGER NOT NULL,
    `minutesRemaining` INTEGER NOT NULL DEFAULT 60,
    `status` ENUM('active', 'listed', 'spent') NOT NULL DEFAULT 'active',
    `originalPriceEur` DECIMAL(10, 2) NULL,
    `ownerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FridayToken_ownerId_status_idx`(`ownerId`, `status`),
    INDEX `FridayToken_issuedYear_status_idx`(`issuedYear`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FridayListing` (
    `id` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `priceEur` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('open', 'sold', 'cancelled') NOT NULL DEFAULT 'open',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    UNIQUE INDEX `FridayListing_tokenId_key`(`tokenId`),
    INDEX `FridayListing_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `FridayListing_sellerId_idx`(`sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FridayTrade` (
    `id` VARCHAR(191) NOT NULL,
    `listingId` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `buyerId` VARCHAR(191) NOT NULL,
    `priceEur` DECIMAL(10, 2) NOT NULL,
    `platformFeeEur` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FridayTrade_buyerId_idx`(`buyerId`),
    INDEX `FridayTrade_sellerId_idx`(`sellerId`),
    INDEX `FridayTrade_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('friday_purchase', 'friday_trade_buy', 'friday_trade_sell') NOT NULL,
    `amountEur` DECIMAL(10, 2) NOT NULL,
    `secondsDelta` INTEGER NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Transaction_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FridayPurchaseItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NOT NULL,
    `unitPriceEur` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FridayPurchaseItem_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `FridayPurchaseItem_tokenId_idx`(`tokenId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FridayToken` ADD CONSTRAINT `FridayToken_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayListing` ADD CONSTRAINT `FridayListing_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `FridayToken`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayListing` ADD CONSTRAINT `FridayListing_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayTrade` ADD CONSTRAINT `FridayTrade_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `FridayListing`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayTrade` ADD CONSTRAINT `FridayTrade_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `FridayToken`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayTrade` ADD CONSTRAINT `FridayTrade_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayTrade` ADD CONSTRAINT `FridayTrade_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayPurchaseItem` ADD CONSTRAINT `FridayPurchaseItem_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FridayPurchaseItem` ADD CONSTRAINT `FridayPurchaseItem_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `FridayToken`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
