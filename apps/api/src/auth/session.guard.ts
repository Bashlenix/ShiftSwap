import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { DomainError } from '../common/domain-error';
import { AUTH, type Auth } from './auth';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export type AuthedRequest = Request & { user: AuthUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    // A deleted account has no sessions, except one a racing sign-in created after the deletion
    // committed: treat it as signed out.
    if (!session || session.user.deletedAt) {
      throw new DomainError('UNAUTHENTICATED', 'Not signed in');
    }
    const { id, email, name } = session.user;
    req.user = { id, email, name };
    return true;
  }
}
