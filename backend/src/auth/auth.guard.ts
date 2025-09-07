import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ClerkStrategy } from './clerk.strategy';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private clerk: ClerkStrategy, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const auth = await this.clerk.verify(req.headers.authorization);
    let user = await this.prisma.user.findUnique({ where: { clerkUserId: auth.clerkId } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          clerkUserId: auth.clerkId,
          email: auth.email ?? `user_${auth.clerkId}@local`,
          role: auth.role === 'admin' ? 'admin' : 'client',
        },
      });
    }
    req.user = { dbId: user.id, clerkId: user.clerkUserId, role: user.role, email: user.email };
    return true;
  }
}
