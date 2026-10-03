import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { AuthService, type AuthUser } from './auth.service.js';
import { CurrentUser, Public, bearer } from './auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { login?: string; password?: string } = {}) {
    if (!body.login || !body.password) throw new BadRequestException('Введите логин и пароль');
    return this.auth.login(body.login, body.password);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Headers('authorization') header?: string) {
    await this.auth.logout(bearer(header));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
