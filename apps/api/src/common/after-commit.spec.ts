import { withAfterCommit } from './after-commit';

type Fn = (tx: unknown) => Promise<unknown>;
function fakePrisma(commits = true) {
  return {
    $transaction: async (fn: Fn) => {
      const result = await fn({});
      if (!commits) throw new Error('commit failed');
      return result;
    },
  };
}

describe('withAfterCommit', () => {
  it('runs queued jobs in order after commit and returns the result', async () => {
    const order: string[] = [];
    const prisma = fakePrisma();
    const result = await withAfterCommit(prisma as never, async (_tx, after) => {
      after(async () => void order.push('a'));
      after(async () => void order.push('b'));
      order.push('body');
      return 42;
    });
    expect(result).toBe(42);
    expect(order).toEqual(['body', 'a', 'b']);
  });

  it('runs no jobs when fn throws', async () => {
    const job = jest.fn();
    await expect(
      withAfterCommit(fakePrisma() as never, async (_tx, after) => {
        after(async () => job());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(job).not.toHaveBeenCalled();
  });

  it('runs no jobs when the commit fails', async () => {
    const job = jest.fn();
    await expect(
      withAfterCommit(fakePrisma(false) as never, async (_tx, after) => {
        after(async () => job());
      }),
    ).rejects.toThrow('commit failed');
    expect(job).not.toHaveBeenCalled();
  });

  it('does not fail the call when a job throws, and still runs later jobs', async () => {
    const second = jest.fn();
    const result = await withAfterCommit(fakePrisma() as never, async (_tx, after) => {
      after(async () => {
        throw new Error('job failed');
      });
      after(async () => second());
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(second).toHaveBeenCalled();
  });
});
