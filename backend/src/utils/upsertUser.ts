// src/utils/upsertUser.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function upsertUser(clerkUserId: string, email?: string) {
  return prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      email: email ?? `${clerkUserId}@unknown.local`,
      role: "client",
    },
  });
}
