// src/utils/upsertUser.ts
import { Prisma } from "@prisma/client";

export function upsertUser(
  tx: Prisma.TransactionClient,
  clerkUserId: string,
  email?: string,
) {
  return tx.user.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      email: email ?? `${clerkUserId}@unknown.local`,
      role: "client",
    },
  });
}
