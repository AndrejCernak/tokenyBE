import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ClerkStrategy } from './clerk.strategy';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private clerk: ClerkStrategy) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] as string | undefined;

    const user = await this.clerk.verifyBearerToken(authHeader);
    req.user = {
      dbId: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      role: user.role,
    }; // 👈 teraz je v req.user len potrebné info
    return true;
  }
}
