import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import { AppOriginRegistry } from './app-origin';
import { NotificationMailer } from './notification-mailer';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global interceptor (registered only outside NODE_ENV=test, like ScheduleModule):
 * remembers the web app's `x-app-origin` (signed-in requests only) for email deep links, and
 * after a successful write request (its transaction has committed) kicks off an outbox dispatch without delaying the
 * response. Rows it misses are picked up by NotificationMailScheduler.
 */
@Injectable()
export class MailDispatchInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MailDispatchInterceptor.name);

  constructor(
    private readonly mailer: NotificationMailer,
    private readonly origins: AppOriginRegistry,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{
      method: string;
      headers: Record<string, string | string[] | undefined>;
      user?: unknown;
    }>();
    // Only signed-in requests may set the deep-link base: interceptors run after guards, so
    // `req.user` is set by SessionGuard here. Otherwise one anonymous request (e.g. a health
    // check) with a trusted-looking header would redirect every org's email links.
    // Residual risk: in Codespace wildcard mode (ALLOW_CODESPACE_ORIGINS=true without
    // CODESPACE_NAME) a signed-in user can still pick any *-5173.app.github.dev host. Accepted:
    // the flag is demo-only and the forwarded port is private (GitHub login required).
    if (req.user) {
      const header = req.headers['x-app-origin'];
      this.origins.remember(Array.isArray(header) ? header[0] : header);
    }
    if (READ_METHODS.has(req.method)) return next.handle();
    return next.handle().pipe(tap({ complete: () => this.dispatch() }));
  }

  private dispatch(): void {
    void this.mailer.dispatchPending().catch((err: unknown) => {
      this.logger.error({ err: err instanceof Error ? err.name : typeof err });
    });
  }
}
