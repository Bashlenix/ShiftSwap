import type { ApiErrorBody, ErrorCode } from '@shiftswap/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: ErrorCode;
  readonly details?: Record<string, unknown>;
  /** The server's human-readable message; only shown where it adds information. */
  readonly serverMessage?: string;

  constructor(status: number, body?: Partial<ApiErrorBody> | null) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
    this.serverMessage = body?.error?.message;
  }
}

async function failure(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    // Not JSON (proxy error page, empty body): status alone is still useful.
  }
  return new ApiError(response.status, body);
}

/**
 * Sent on every request: the api remembers the last trusted value as the base for email deep
 * links, which is the only way it learns the public URL inside a Codespace (SDD §23).
 */
const appOrigin = () => ({ 'x-app-origin': window.location.origin });

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'include', headers: appOrigin() });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method, credentials: 'include', headers: appOrigin() }
      : {
          method,
          credentials: 'include',
          headers: { ...appOrigin(), 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
  const response = await fetch(path, init);
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
