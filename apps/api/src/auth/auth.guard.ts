import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type AuthUser } from './auth.service.js';

const IS_PUBLIC = 'df:isPublic';
/** Marks a route that needs no login (health, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const bearer = (header?: string) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

/** Every route needs a session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const user = await this.auth.userFromToken(bearer(req.headers.authorization));
    if (!user) throw new UnauthorizedException('Требуется вход');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
