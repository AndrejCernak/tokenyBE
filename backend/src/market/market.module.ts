import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Module({
  imports: [AuthModule, DbModule, ConfigModule],
  controllers: [MarketController],
  providers: [
    {
      provide: 'STRIPE',
      useFactory: (cfg: ConfigService) => new Stripe(cfg.get('STRIPE_SECRET_KEY')!),
      inject: [ConfigService],
    },
  ],
})
export class MarketModule {}
