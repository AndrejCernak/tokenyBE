import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

@Injectable()
export class ClerkStrategy {
  async verify(authHeader?: string) {
    const mode = process.env.AUTH_MODE ?? 'clerk';
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization: Bearer <token>');
    }
    const token = authHeader.slice(7);

    // DEV režim: Bearer dev:<user-id>:<role>
    if (mode === 'dev' && token.startsWith('dev:')) {
      const [, userId, role] = token.split(':');
      return {
        clerkId: userId || 'dev-user',
        email: `dev_${userId ?? 'user'}@local`,
        role: (role === 'admin' ? 'admin' : 'client') as 'admin' | 'client',
      };
    }

    // Produkčný režim: verifikácia cez Clerk
    try {
      const verified: any = await verifyToken(token, {});
      const claims = verified?.claims ?? verified?.payload ?? {};
      const clerkId = verified?.sub ?? claims?.sub ?? claims?.userId;
      return {
        clerkId,
        email: claims?.email as string | undefined,
        role: (claims?.role as 'admin' | 'client') ?? 'client',
      };
    } catch {
      throw new UnauthorizedException('Invalid Clerk token');
    }
  }
}
