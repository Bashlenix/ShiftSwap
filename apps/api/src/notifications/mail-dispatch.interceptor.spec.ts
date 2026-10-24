import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { AppOriginRegistry } from './app-origin';
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
  const run = (method: string, handler: CallHandler, headers: Record<string, string> = {}) => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
    } as unknown as ExecutionContext;
    return lastValueFrom(interceptor.intercept(context, handler));
  };
  return { mailer, origins, run };
}

const ok: CallHandler = { handle: () => of({ ok: true }) };
const failing: CallHandler = { handle: () => throwError(() => new Error('conflict')) };

describe('MailDispatchInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  it('remembers the x-app-origin header', async () => {
    const { origins, run } = setup();
    await run('GET', ok, { 'x-app-origin': 'http://localhost:5173' });
    expect(origins.remember).toHaveBeenCalledWith('http://localhost:5173');
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
