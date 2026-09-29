import { Module } from '@nestjs/common';
import { SalesdocCredentialsStore } from './salesdoc-credentials.store.js';
import { SalesdocClient } from './salesdoc.client.js';
import { SalesdocController } from './salesdoc.controller.js';

@Module({
  controllers: [SalesdocController],
  providers: [SalesdocCredentialsStore, SalesdocClient],
  exports: [SalesdocClient],
})
export class SalesdocModule {}
