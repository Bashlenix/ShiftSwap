import { Injectable } from '@nestjs/common';
import { isTrustedOrigin, resolveBaseUrl } from '../config/auth-config';

const DEFAULT_BASE_URL = 'http://localhost:5173';

/**
 * Deep-link base for notification emails (SDD §23). The web app sends `x-app-origin` on every
 * request; inside a Codespace that is the only reliable public URL the api ever sees.
 * Priority: last trusted header seen → resolveBaseUrl(env) → http://localhost:5173.
 * In-memory per process; after a restart the env fallback applies until the next request.
 */
@Injectable()
export class AppOriginRegistry {
  private last: string | undefined;

  /** Keeps the origin only when isTrustedOrigin accepts it; anything else is ignored. */
  remember(origin: string | undefined): void {
    if (origin && isTrustedOrigin(origin, process.env)) this.last = origin;
  }

  baseUrl(): string {
    return this.last ?? resolveBaseUrl(process.env) ?? DEFAULT_BASE_URL;
  }
}
