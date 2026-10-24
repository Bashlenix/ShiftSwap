import type { IncomingHttpHeaders } from 'node:http';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from '../common/client-ip';

/** Buckets by the same client IP the auth rate limiter uses (X-Forwarded-For, loopback hops skipped). */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const { headers, socket } = req as {
      headers: IncomingHttpHeaders;
      socket?: { remoteAddress?: string };
    };
    return Promise.resolve(clientIp(headers, socket?.remoteAddress));
  }
}
