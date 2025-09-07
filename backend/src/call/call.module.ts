import { Module } from '@nestjs/common';
import { CallGateway } from './call.gateway';
import { CallService } from './call.service';
import { DbModule } from '../db/db.module';
import { AuthModule } from '../auth/auth.module';
import { TickerService } from './ticker.service';

@Module({
  imports: [DbModule, AuthModule],
  providers: [CallGateway, CallService, TickerService],
})
export class CallModule {}