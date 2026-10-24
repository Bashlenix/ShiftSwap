import { Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

const logger = new Logger('AfterCommit');

/**
 * Runs `fn` in a transaction, then (only after a successful commit) the jobs queued
 * via `after`, sequentially. Job errors are logged and swallowed; a rolled-back
 * transaction runs no jobs.
 */
export async function withAfterCommit<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient, after: (job: () => Promise<void>) => void) => Promise<T>,
): Promise<T> {
  const jobs: Array<() => Promise<void>> = [];
  const result = await prisma.$transaction((tx) => fn(tx, (job) => void jobs.push(job)));
  for (const job of jobs) {
    try {
      await job();
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.name : 'unknown' });
    }
  }
  return result;
}
