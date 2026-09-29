import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, database: 'up' };
    } catch {
      return { ok: false, database: 'down' };
    }
  }
}
