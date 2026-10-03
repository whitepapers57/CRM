/**
 * Manage logins (there is no sign-up page):
 *   npm run user:add -w @df/api        → asks login, name, password
 *   npm run user:passwd -w @df/api     → asks login, new password
 *   npm run user:disable -w @df/api    → asks login
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';

process.loadEnvFile();

/** Reads a line without echoing it (for passwords). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(1);
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function newPassword(): Promise<string> {
  const a = await askHidden('Пароль: ');
  const b = await askHidden('Ещё раз: ');
  if (a.length < 8) throw new Error('Пароль: не меньше 8 символов');
  if (a !== b) throw new Error('Пароли не совпадают');
  return a;
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const auth = new AuthService(prisma as unknown as PrismaService);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const command = process.argv[2];

try {
  const login = (await rl.question('Логин: ')).trim();
  if (command === 'add') {
    const name = (await rl.question('Имя (как показывать в истории): ')).trim();
    rl.close();
    await auth.createUser(login, name, await newPassword());
    console.log(`Создан пользователь ${login}`);
  } else if (command === 'passwd') {
    rl.close();
    await auth.setPassword(login, await newPassword());
    console.log(`Пароль изменён: ${login}`);
  } else if (command === 'disable') {
    rl.close();
    await auth.disable(login);
    console.log(`Отключён: ${login}`);
  } else {
    throw new Error('Команда: add | passwd | disable');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rl.close();
  await prisma.$disconnect();
}
