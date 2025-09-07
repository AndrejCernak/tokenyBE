import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { IceModule } from './ice/ice.module';
import { WalletModule } from './wallet/wallet.module';
import { ListingModule } from './listing/listing.module';
import { MarketModule } from './market/market.module';
import { StripeModule } from './stripe/stripe.module';
import { CallModule } from './call/call.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    HealthModule,
    IceModule,
    WalletModule,
    ListingModule,
    MarketModule,
    StripeModule,
    CallModule,
  ],
})
export class AppModule {}
