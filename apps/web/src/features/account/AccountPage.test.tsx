import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { AccountPage } from './AccountPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

function LoginStub() {
  const { state } = useLocation() as { state: { notice?: string } | null };
  return <p>login page: {state?.notice}</p>;
}

const me = {
  user: { id: 'u1', email: 'anna@shiftswap.test', name: 'Anna' },
  memberships: [
    { membershipId: 'm1', organizationId: 'o1', organizationName: 'Café Lindenhof' },
    { membershipId: 'm2', organizationId: 'o2', organizationName: 'Bäckerei Sonne' },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/account', element: <AccountPage /> },
      { path: '/login', element: <LoginStub /> },
    ],
    { initialEntries: ['/account'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Delete account…' }));
  return screen.findByRole('alertdialog');
}

describe('AccountPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
    apiFetch.mockResolvedValue(me);
  });

  it('shows name and email', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(await screen.findByText('Anna')).toBeVisible();
    expect(screen.getByText('anna@shiftswap.test')).toBeVisible();
  });

  it('enables the confirm button only for DELETE', async () => {
    renderPage();
    await openDialog();
    const confirm = screen.getByRole('button', { name: 'Delete my account' });
    const input = screen.getByLabelText('Type DELETE to confirm');
    expect(confirm).toBeDisabled();
    await userEvent.type(input, 'delete');
    expect(confirm).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'DELETE');
    expect(confirm).toBeEnabled();
  });

  it('deletes, clears the cache and goes to login with a notice', async () => {
    apiSend.mockResolvedValue(undefined);
    const { router, client } = renderPage();
    await openDialog();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(apiSend).toHaveBeenCalledWith('DELETE', '/api/v1/me', { confirm: 'DELETE' });
    expect(router.state.location.state).toEqual({ notice: 'Your account was deleted.' });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('names the organisations on LAST_ADMIN', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'LAST_ADMIN', message: 'x', details: { organizationIds: ['o1', 'o2'] } },
      }),
    );
    renderPage();
    await openDialog();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are the last admin of Café Lindenhof, Bäckerei Sonne. Make another member an admin first.',
    );
  });

  it('sends one request on a double click', async () => {
    let resolve!: () => void;
    apiSend.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderPage();
    await openDialog();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Delete my account' }));
    expect(apiSend).toHaveBeenCalledTimes(1);
    resolve();
  });

  it('returns focus to the trigger after Cancel', async () => {
    renderPage();
    await openDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete account…' })).toHaveFocus(),
    );
  });

  it('stays open on Esc while the request runs and then shows LAST_ADMIN', async () => {
    let reject!: (e: unknown) => void;
    apiSend.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderPage();
    await openDialog();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    reject(
      new ApiError(409, {
        error: { code: 'LAST_ADMIN', message: 'x', details: { organizationIds: ['o1'] } },
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('last admin of Café Lindenhof');
  });

  it('does not close on an overlay click', async () => {
    renderPage();
    await openDialog();
    const overlay = document.querySelector('.bg-black\\/50') as HTMLElement;
    await userEvent.click(overlay);
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });

  it('closes on Esc when idle and returns focus', async () => {
    renderPage();
    await openDialog();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete account…' })).toHaveFocus(),
    );
  });
});
