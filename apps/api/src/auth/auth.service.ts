import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';

export interface AuthUser {
  id: string;
  login: string;
  name: string;
}

const SESSION_DAYS = 30;
const BAD_LOGIN = 'Неверный логин или пароль';

const scrypt = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const normal = (login: string) => login.trim().toLowerCase();

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scrypt(pw, salt)).toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'base64'));
  const want = Buffer.from(key, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(login: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const u = await this.prisma.user.findUnique({ where: { login: normal(login) } });
    if (!u || !u.active || !(await verifyPassword(password, u.passwordHash))) {
      throw new UnauthorizedException(BAD_LOGIN);
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: { id: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) },
    });
    return { token, user: { id: u.id, login: u.login, name: u.name } };
  }

  async userFromToken(token?: string): Promise<AuthUser | null> {
    if (!token) return null;
    const s = await this.prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
    if (!s || s.expiresAt <= new Date() || !s.user.active) return null;
    return { id: s.user.id, login: s.user.login, name: s.user.name };
  }

  async logout(token?: string): Promise<void> {
    if (token) await this.prisma.session.deleteMany({ where: { id: sha256(token) } });
  }

  createUser(login: string, name: string, password: string) {
    return hashPassword(password).then((passwordHash) =>
      this.prisma.user.create({ data: { login: normal(login), name: name.trim(), passwordHash } }),
    );
  }

  async setPassword(login: string, password: string): Promise<void> {
    const res = await this.prisma.user.updateMany({
      where: { login: normal(login) },
      data: { passwordHash: await hashPassword(password) },
    });
    if (res.count === 0) throw new NotFoundException(`No user ${login}`);
  }

  async disable(login: string): Promise<void> {
    const u = await this.prisma.user.update({ where: { login: normal(login) }, data: { active: false } });
    await this.prisma.session.deleteMany({ where: { userId: u.id } });
  }
}
