import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuthService, hashPassword, verifyPassword } from './auth.service.js';

const db = createTestDb();
const auth = new AuthService(db);

describe('AuthService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('secret-1');
    const b = await hashPassword('secret-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('secret-1', a)).toBe(true);
    expect(await verifyPassword('secret-2', a)).toBe(false);
  });

  it('logs in by login (any case) and resolves the token back to the user', async () => {
    await auth.createUser('Sardor', 'Сардорбек', 'pass-123');
    const { token, user } = await auth.login(' SARDOR ', 'pass-123');
    expect(user).toMatchObject({ login: 'sardor', name: 'Сардорбек' });
    expect(await auth.userFromToken(token)).toMatchObject({ id: user.id, name: 'Сардорбек' });
    const stored = await db.session.findFirstOrThrow();
    expect(stored.id).not.toBe(token);
  });

  it('gives the same error for a wrong password and an unknown login', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    await expect(auth.login('sardor', 'nope')).rejects.toThrow('Неверный логин или пароль');
    await expect(auth.login('ghost', 'pass-123')).rejects.toThrow('Неверный логин или пароль');
  });

  it('stops a session as soon as its user is disabled', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    const { token } = await auth.login('sardor', 'pass-123');
    await auth.disable('sardor');
    expect(await auth.userFromToken(token)).toBeNull();
    await expect(auth.login('sardor', 'pass-123')).rejects.toThrow('Неверный логин или пароль');
  });

  it('stops a live session when the user is switched off without deleting its sessions', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    const { token } = await auth.login('sardor', 'pass-123');
    await db.user.updateMany({ data: { active: false } });
    expect(await db.session.count()).toBe(1);
    expect(await auth.userFromToken(token)).toBeNull();
  });

  it('rejects expired sessions, unknown tokens and logged-out tokens', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    const { token } = await auth.login('sardor', 'pass-123');
    expect(await auth.userFromToken('made-up')).toBeNull();
    expect(await auth.userFromToken(undefined)).toBeNull();
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await auth.userFromToken(token)).toBeNull();

    const second = await auth.login('sardor', 'pass-123');
    await auth.logout(second.token);
    expect(await auth.userFromToken(second.token)).toBeNull();
  });

  it('changes a password', async () => {
    await auth.createUser('sardor', 'Сардорбек', 'pass-123');
    await auth.setPassword('sardor', 'new-pass-456');
    await expect(auth.login('sardor', 'pass-123')).rejects.toThrow();
    expect((await auth.login('sardor', 'new-pass-456')).user.login).toBe('sardor');
  });
});
