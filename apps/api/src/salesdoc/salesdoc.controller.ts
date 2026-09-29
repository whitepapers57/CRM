import { Controller, Get } from '@nestjs/common';
import { SalesdocClient, SalesdocError } from './salesdoc.client.js';

@Controller('salesdoc')
export class SalesdocController {
  constructor(private readonly salesdoc: SalesdocClient) {}

  /** Whether credentials exist and a login succeeds. Never returns the token. */
  @Get('status')
  async status() {
    if (!this.salesdoc.isConfigured()) {
      return { configured: false, connected: false };
    }
    try {
      const { userId } = await this.salesdoc.connect();
      return { configured: true, connected: true, userId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const code = e instanceof SalesdocError ? e.code : undefined;
      return { configured: true, connected: false, error: { code, message } };
    }
  }
}
