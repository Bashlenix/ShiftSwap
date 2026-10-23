import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, apiSend } from './api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('parses code and details from an error body', async () => {
    mockFetch(422, {
      error: { code: 'INELIGIBLE', message: 'no', details: { failedRules: ['OVERLAP'] } },
    });
    const err = await apiFetch('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
      code: 'INELIGIBLE',
      details: { failedRules: ['OVERLAP'] },
    });
  });

  it('still throws ApiError when the error body is not JSON', async () => {
    mockFetch(502);
    const err = await apiFetch('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: undefined });
  });

  it('apiSend posts JSON with credentials', async () => {
    const fn = mockFetch(201, { id: 'a' });
    await expect(apiSend('POST', '/x', { a: 1 })).resolves.toEqual({ id: 'a' });
    expect(fn).toHaveBeenCalledWith('/x', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('apiSend returns undefined for 204 and sends no body when none given', async () => {
    const fn = mockFetch(204);
    await expect(apiSend('DELETE', '/x')).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledWith('/x', { method: 'DELETE', credentials: 'include' });
  });

  it('apiSend throws ApiError with parsed code', async () => {
    mockFetch(409, { error: { code: 'OFFER_ALREADY_FILLED', message: 'x' } });
    await expect(apiSend('POST', '/x')).rejects.toMatchObject({
      status: 409,
      code: 'OFFER_ALREADY_FILLED',
    });
  });
});
