import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the real better-auth client (its nanostores session atom included) against a stubbed
// fetch, so the race between sign-in and the session refetch is the library's own.

const SESSION = {
  session: {
    id: 's1',
    userId: 'u1',
    token: 't',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  },
  user: {
    id: 'u1',
    email: 'lukas@shiftswap.test',
    name: 'Lukas',
    emailVerified: false,
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  },
};
const ME = {
  user: { id: 'u1', email: 'lukas@shiftswap.test', name: 'Lukas' },
  memberships: [
    {
      membershipId: 'm1',
      organizationId: 'o1',
      organizationName: 'Café Lindenhof',
      organizationTimezone: 'Europe/Berlin',
      offerLeadTimeMin: 120,
      accessLevel: 'EMPLOYEE',
    },
  ],
};

let signedIn = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const path = url.pathname;
  if (path === '/api/auth/get-session') return json(signedIn ? SESSION : null);
  if (path === '/api/auth/sign-in/email' || path === '/api/auth/sign-up/email') {
    signedIn = true;
    return json({ token: 't', user: SESSION.user, redirect: false });
  }
  if (path === '/api/v1/me') return json(ME);
  if (path === '/api/v1/invites/tok-1')
    return json({
      organizationName: 'Café Lindenhof',
      email: 'lukas@shiftswap.test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      state: 'VALID',
    });
  if (path === '/api/v1/invites/tok-1/accept') return json({ organizationId: 'o1' });
  return json({ error: { code: 'NOT_FOUND', message: 'not stubbed', details: {} } }, 404);
}

async function renderApp(entry: string) {
  // Fresh modules per test: a new auth client, so no session state leaks between tests.
  vi.resetModules();
  const { router } = await import('../../router');
  const memory = createMemoryRouter(router.routes, { initialEntries: [entry] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={memory} />
    </QueryClientProvider>,
  );
  return memory;
}

describe('one click signs the user in', () => {
  beforeEach(() => {
    signedIn = false;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('log in after the /orgs → /login redirect lands on the org picker', async () => {
    await renderApp('/orgs');
    await screen.findByRole('heading', { name: 'Log in to ShiftSwap' });
    await userEvent.type(screen.getByLabelText('Email'), 'lukas@shiftswap.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Log in to ShiftSwap' })).toBeNull();
  });

  it('sign up after the /orgs → /login redirect lands on the org picker', async () => {
    await renderApp('/orgs');
    await userEvent.click(await screen.findByRole('link', { name: 'Create an account' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Lukas');
    await userEvent.type(screen.getByLabelText('Email'), 'lukas@shiftswap.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Log in to ShiftSwap' })).toBeNull();
  });

  it('invite sign-up lands in the organisation', async () => {
    const memory = await renderApp('/invites/tok-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Lukas');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(memory.state.location.pathname).toMatch(/^\/orgs\/o1\//);
    expect(screen.queryByRole('heading', { name: 'Log in to ShiftSwap' })).toBeNull();
  });
});
