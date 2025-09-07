import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';

@Module({ imports: [AuthModule, DbModule], controllers: [WalletController] })
export class WalletModule {}
