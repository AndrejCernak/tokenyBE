import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';

@Controller('ice')
@UseGuards(AuthGuard)
export class IceController {
  @Get()
  getIce() {
    return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
  }
}
