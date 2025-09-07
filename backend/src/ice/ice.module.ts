import { Module } from '@nestjs/common';
import { IceController } from './ice.controller';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';

@Module({
  imports: [AuthModule, DbModule], // DbModule nie je nutný, ale nevadí
  controllers: [IceController],
})
export class IceModule {}
