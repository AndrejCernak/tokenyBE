import { Module } from '@nestjs/common';
import { StripeController } from './stripe.controller';
import { DbModule } from '../db/db.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Module({
  imports: [DbModule, ConfigModule],
  controllers: [StripeController],
  providers: [
    {
      provide: 'STRIPE',
      useFactory: (cfg: ConfigService) => new Stripe(cfg.get('STRIPE_SECRET_KEY')!),
      inject: [ConfigService],
    },
  ],
})
export class StripeModule {}
