import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';

@Module({ imports: [AuthModule, DbModule], controllers: [ListingController] })
export class ListingModule {}
