// src/auth/auth.module.ts
import { Module } from "@nestjs/common";
import { ClerkStrategy } from "./clerk.strategy";
import { AuthGuard } from "./auth.guard";
import { DbModule } from "../db/db.module";

@Module({
  imports: [DbModule],   // 👈 toto je dôležité
  providers: [ClerkStrategy, AuthGuard],
  exports: [ClerkStrategy, AuthGuard], // 👈 toto je kľúčové
})
export class AuthModule {}
