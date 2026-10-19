import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { databaseUrl } from '../config';

/**
 * Standard NestJS Prisma recipe: one client per app, connected in
 * `onModuleInit`, disconnected in `onModuleDestroy` (which Nest calls
 * during shutdown when `app.enableShutdownHooks()` is set in main.ts).
 *
 * Note: the old `$on('beforeExit')` enableShutdownHooks trick from the
 * recipe no longer applies — Prisma 6 removed the `beforeExit` hook.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  public constructor() {
    super({ datasourceUrl: databaseUrl() });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
