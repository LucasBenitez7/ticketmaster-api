/*
  Warnings:

  - You are about to drop the column `availableTickets` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `totalTickets` on the `events` table. All the data in the column will be lost.
  - Added the required column `categoryId` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expiresAt` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `categoryId` to the `tickets` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RefundPolicy" AS ENUM ('REFUNDABLE', 'PARTIAL', 'NON_REFUNDABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "events" DROP COLUMN "availableTickets",
DROP COLUMN "price",
DROP COLUMN "totalTickets",
ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "refundAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "categoryId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "totalStock" INTEGER NOT NULL,
    "availableStock" INTEGER NOT NULL,
    "maxTicketsPerUser" INTEGER NOT NULL DEFAULT 10,
    "refundPolicy" "RefundPolicy" NOT NULL DEFAULT 'REFUNDABLE',
    "refundPercentage" INTEGER NOT NULL DEFAULT 100,
    "refundDeadlineHours" INTEGER NOT NULL DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
