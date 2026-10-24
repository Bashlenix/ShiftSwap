import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { RETENTION_CRON, RetentionScheduler } from './retention.scheduler';
import type { RetentionService } from './retention.service';

describe('RetentionScheduler', () => {
  const make = (purge: jest.Mock) =>
    new RetentionScheduler({ purge } as unknown as RetentionService);

  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs at 03:00 UTC', () => {
    expect(RETENTION_CRON).toBe('0 3 * * *');
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, RetentionScheduler.prototype.tick);
    expect(meta).toMatchObject({ timeZone: 'UTC' });
  });

  it('purges with the current time and logs the counts', async () => {
    const counts = {
      shifts: 1,
      offers: 2,
      acceptances: 3,
      auditLogs: 4,
      notifications: 5,
      unavailabilities: 6,
    };
    const purge = jest.fn().mockResolvedValue(counts);
    await make(purge).tick();
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(log).toHaveBeenCalledWith(counts);
  });

  it('swallows and logs errors by name only', async () => {
    const purge = jest.fn().mockRejectedValue(new TypeError('secret detail anna@example.com'));
    await expect(make(purge).tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith({ err: 'TypeError' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
  });
});
