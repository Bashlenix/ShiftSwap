import { Logger } from '@nestjs/common';
import { SCHEDULE_INTERVAL_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ExpiryScheduler } from './expiry.scheduler';
import type { OffersService } from './offers.service';

describe('ExpiryScheduler', () => {
  const make = (expireDue: jest.Mock) =>
    new ExpiryScheduler({ expireDue } as unknown as OffersService);

  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('runs every 5 minutes', () => {
    const meta = Reflect.getMetadata(SCHEDULE_INTERVAL_OPTIONS, ExpiryScheduler.prototype.tick);
    expect(meta).toEqual({ timeout: 5 * 60 * 1000 });
  });

  it('calls expireDue once per tick and logs only the count', async () => {
    const expireDue = jest.fn().mockResolvedValue(3);
    const scheduler = make(expireDue);
    await scheduler.tick();
    await scheduler.tick();
    expect(expireDue).toHaveBeenCalledTimes(2);
    expect(expireDue.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(log).toHaveBeenCalledWith({ expired: 3 });
  });

  it('swallows and logs errors by name only', async () => {
    const boom = new TypeError('secret detail anna@example.com');
    const expireDue = jest.fn().mockRejectedValue(boom);
    const scheduler = make(expireDue);
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith({ err: 'TypeError' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
  });
});
