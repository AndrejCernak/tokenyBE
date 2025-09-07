import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../db/prisma.service';

@Controller('wallet')
@UseGuards(AuthGuard)
export class WalletController {
  constructor(private prisma: PrismaService) {}

  @Get('me')
  async myTokens(@Req() req: any) {
    const userId = req.user.dbId as string;
    const tokens = await this.prisma.token.findMany({
      where: { ownerId: userId },
      select: { id: true, remainingMinutes: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { tokens };
  }
}
