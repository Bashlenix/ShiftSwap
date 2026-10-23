import { DynamicModule, Global, Module } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

@Global()
@Module({})
export class PrismaModule {
  /** `override` replaces the PrismaService provider (used by tests). */
  static register(override?: PrismaClient): DynamicModule {
    return {
      module: PrismaModule,
      providers: override ? [{ provide: PrismaService, useValue: override }] : [PrismaService],
      exports: [PrismaService],
    };
  }
}
