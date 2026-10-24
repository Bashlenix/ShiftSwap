import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AppOriginRegistry } from './app-origin';
import { MailDispatchInterceptor } from './mail-dispatch.interceptor';
import type { NotificationMailer } from './notification-mailer';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(dispatch: () => Promise<number> = () => Promise.resolve(0)) {
  const mailer = { dispatchPending: jest.fn(dispatch) };
  const origins = { remember: jest.fn() };
  const interceptor = new MailDispatchInterceptor(
    mailer as unknown as NotificationMailer,
    origins as unknown as AppOriginRegistry,
  );
  const run = (
    method: string,
    handler: CallHandler,
    headers: Record<string, string> = {},
    user: { id: string } | null = { id: 'u1' },
  ) => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ method, headers, user }) }),
    } as unknown as ExecutionContext;
    return lastValueFrom(interceptor.intercept(context, handler));
  };
  return { mailer, origins, run };
}

const ok: CallHandler = { handle: () => of({ ok: true }) };
const failing: CallHandler = { handle: () => throwError(() => new Error('conflict')) };

describe('MailDispatchInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  it('remembers the x-app-origin header of a signed-in request', async () => {
    const { origins, run } = setup();
    await run('GET', ok, { 'x-app-origin': 'http://localhost:5173' });
    expect(origins.remember).toHaveBeenCalledWith('http://localhost:5173');
  });

  it('never remembers the header of an unauthenticated request', async () => {
    const { origins, run } = setup();
    await run('GET', ok, { 'x-app-origin': 'http://localhost:5173' }, null);
    expect(origins.remember).not.toHaveBeenCalled();
  });

  describe('with a real registry in Codespace wildcard mode', () => {
    const saved = { ...process.env };
    beforeEach(() => {
      process.env.ALLOW_CODESPACE_ORIGINS = 'true';
      delete process.env.CODESPACE_NAME;
      delete process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    });
    afterAll(() => {
      process.env = saved;
    });

    const realSetup = () => {
      const registry = new AppOriginRegistry();
      const interceptor = new MailDispatchInterceptor(
        { dispatchPending: jest.fn(() => Promise.resolve(0)) } as unknown as NotificationMailer,
        registry,
      );
      const run = (headers: Record<string, string>, user?: { id: string }) =>
        lastValueFrom(
          interceptor.intercept(
            {
              getType: () => 'http',
              switchToHttp: () => ({ getRequest: () => ({ method: 'GET', headers, user }) }),
            } as unknown as ExecutionContext,
            ok,
          ),
        );
      return { registry, run };
    };

    it('an unauthenticated trusted-looking header does not change baseUrl()', async () => {
      const { registry, run } = realSetup();
      await run({ 'x-app-origin': 'https://attacker-5173.app.github.dev' });
      expect(registry.baseUrl()).toBe('http://localhost:5173');
    });

    it('a signed-in request changes baseUrl()', async () => {
      const { registry, run } = realSetup();
      await run({ 'x-app-origin': 'https://real-5173.app.github.dev' }, { id: 'u1' });
      expect(registry.baseUrl()).toBe('https://real-5173.app.github.dev');
    });
  });

  it('dispatches once after a successful POST', async () => {
    const { mailer, run } = setup();
    await expect(run('POST', ok)).resolves.toEqual({ ok: true });
    await flush();
    expect(mailer.dispatchPending).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch for a GET', async () => {
    const { mailer, run } = setup();
    await run('GET', ok);
    await flush();
    expect(mailer.dispatchPending).not.toHaveBeenCalled();
  });

  it('does not dispatch for a failed POST', async () => {
    const { mailer, run } = setup();
    await expect(run('POST', failing)).rejects.toThrow('conflict');
    await flush();
    expect(mailer.dispatchPending).not.toHaveBeenCalled();
  });

  it('does not make the response wait for the dispatch', async () => {
    const { mailer, run } = setup(() => new Promise<number>(() => undefined));
    await expect(run('PATCH', ok)).resolves.toEqual({ ok: true });
    expect(mailer.dispatchPending).toHaveBeenCalledTimes(1);
  });

  it('logs a dispatch rejection by error name only', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const err = new Error('secret@example.com unreachable');
    err.name = 'MailBoomError';
    const { run } = setup(() => Promise.reject(err));
    await expect(run('POST', ok)).resolves.toEqual({ ok: true });
    await flush();
    expect(error).toHaveBeenCalledWith({ err: 'MailBoomError' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret@example.com');
  });
});
