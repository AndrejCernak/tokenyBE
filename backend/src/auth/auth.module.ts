import { Module } from '@nestjs/common';
import { ClerkStrategy } from './clerk.strategy';
import { AuthGuard } from './auth.guard';
import { DbModule } from '../db/db.module';

@Module({
  imports: [DbModule],                 // <-- aby mal guard prístup k PrismaService
  providers: [ClerkStrategy, AuthGuard],
  exports: [ClerkStrategy, AuthGuard], // <-- aby si mohol guard používať v iných moduloch
})
export class AuthModule {}
