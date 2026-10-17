import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  // 17 Oct 2026: listened on every interface, always:
  // await app.listen(process.env.PORT ?? 4000);
  // HOST (127.0.0.1 on the shared server) keeps it behind nginx; unset, it listens on every interface as before.
  const port = process.env.PORT ?? 4000;
  await (process.env.HOST ? app.listen(port, process.env.HOST) : app.listen(port));
}
await bootstrap();
