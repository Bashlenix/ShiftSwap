import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { AcceptInvitePage } from './AcceptInvitePage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));
const useSession = vi.hoisted(() => vi.fn());
const signUpEmail = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth-client', () => ({
  authClient: { useSession, signUp: { email: signUpEmail }, signOut },
}));

const preview = (state = 'VALID') => ({
  organizationName: 'Café Lindenhof',
  email: 'Lukas@shiftswap.test',
  expiresAt: '2026-11-01T00:00:00.000Z',
  state,
});
const signedOut = { data: null, isPending: false };
const signedInAs = (email: string) => ({ data: { user: { email } }, isPending: false });
const err = (status: number, code?: string, details?: Record<string, unknown>) =>
  new ApiError(status, code ? { error: { code, details } as never } : null);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const router = createMemoryRouter(
    [
      { path: '/invites/:token', element: <AcceptInvitePage /> },
      { path: '/orgs/:id', element: <p>org detail</p> },
      { path: '/login', element: <p>login page</p> },
    ],
    { initialEntries: ['/invites/tok-1'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, invalidate };
}

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
    useSession.mockReset();
    signUpEmail.mockReset();
    signOut.mockReset();
    useSession.mockReturnValue(signedOut);
  });

  it.each([
    ['USED', 'This invite has already been used.'],
    ['EXPIRED', 'This invite has expired. Ask your manager to send a new one.'],
    ['REVOKED', 'This invite was replaced by a newer one.'],
  ])('shows copy for state %s', async (state, copy) => {
    apiFetch.mockResolvedValue(preview(state));
    renderPage();
    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.queryByRole('button', { name: /create account|join/i })).toBeNull();
  });

  it('shows a not-valid page for an unknown token', async () => {
    apiFetch.mockRejectedValue(err(404, 'NOT_FOUND'));
    renderPage();
    expect(await screen.findByText('This invite link is not valid.')).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/invites/tok-1');
  });

  it('signed out: heading, invited email and two actions', async () => {
    apiFetch.mockResolvedValue(preview());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Join Café Lindenhof' })).toBeVisible();
    expect(screen.getByText('Invited: Lukas@shiftswap.test')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'I already have an account' })).toHaveAttribute(
      'href',
      '/login?next=%2Finvites%2Ftok-1',
    );
  });

  async function openForm() {
    await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
  }

  it('signed out: signs up with the invite email, accepts, navigates and invalidates /me', async () => {
    apiFetch.mockResolvedValue(preview());
    signUpEmail.mockResolvedValue({ data: {} });
    apiSend.mockResolvedValue({ organizationId: 'org-9' });
    const { router, invalidate } = renderPage();
    await openForm();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('readonly');
    expect(email).toHaveValue('Lukas@shiftswap.test');
    expect(screen.getByText('At least 8 characters')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Name'), 'Lukas Weber');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/org-9'));
    expect(signUpEmail).toHaveBeenCalledWith({
      email: 'lukas@shiftswap.test',
      password: 'longenough1',
      name: 'Lukas Weber',
    });
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/invites/tok-1/accept');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  it('signed out: existing account shows log-in hint and does not accept', async () => {
    apiFetch.mockResolvedValue(preview());
    signUpEmail.mockResolvedValue({ error: { status: 422, code: 'USER_ALREADY_EXISTS' } });
    renderPage();
    await openForm();
    await userEvent.type(screen.getByLabelText('Name'), 'Lukas');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have an account. Log in to join.',
    );
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?next=%2Finvites%2Ftok-1',
    );
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('signed out: short password is rejected and focused', async () => {
    apiFetch.mockResolvedValue(preview());
    renderPage();
    await openForm();
    await userEvent.type(screen.getByLabelText('Name'), 'Lukas');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByText('Use at least 8 characters')).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('signed in with the matching email (any case): join button accepts', async () => {
    useSession.mockReturnValue(signedInAs('LUKAS@shiftswap.test'));
    apiFetch.mockResolvedValue(preview());
    apiSend.mockResolvedValue({ organizationId: 'org-9' });
    const { router, invalidate } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Join Café Lindenhof' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/org-9'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  it('signed in with another email: shows mismatch up front, never calls accept, can log out', async () => {
    useSession.mockReturnValue(signedInAs('anna@shiftswap.test'));
    apiFetch.mockResolvedValue(preview());
    signOut.mockResolvedValue({});
    renderPage();
    expect(
      await screen.findByText(
        "You're signed in as anna@shiftswap.test, but this invite is for Lukas@shiftswap.test.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Join Café Lindenhof' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('server EMAIL_MISMATCH shows the mismatch message', async () => {
    useSession.mockReturnValue(signedInAs('lukas@shiftswap.test'));
    apiFetch.mockResolvedValue(preview());
    apiSend.mockRejectedValue(err(403, 'EMAIL_MISMATCH'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Join Café Lindenhof' }));
    expect(await screen.findByText(/You're signed in as lukas@shiftswap.test, but/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  it('accept 410 shows the copy for the returned state', async () => {
    useSession.mockReturnValue(signedInAs('lukas@shiftswap.test'));
    apiFetch.mockResolvedValue(preview());
    apiSend.mockRejectedValue(err(410, 'INVITE_INVALID', { state: 'USED' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Join Café Lindenhof' }));
    expect(await screen.findByText('This invite has already been used.')).toBeVisible();
  });

  it('accept 429 shows the rate-limit copy', async () => {
    useSession.mockReturnValue(signedInAs('lukas@shiftswap.test'));
    apiFetch.mockResolvedValue(preview());
    apiSend.mockRejectedValue(err(429, 'RATE_LIMITED'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Join Café Lindenhof' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests.');
  });
});
