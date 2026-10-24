import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgPickerPage } from './OrgPickerPage';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
}));
const signOut = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth-client', () => ({ authClient: { signOut } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/orgs', element: <OrgPickerPage /> },
      { path: '/login', element: <p>login page</p> },
    ],
    { initialEntries: ['/orgs'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

const user = { id: 'u1', email: 'a@b.test', name: 'Anna' };

describe('OrgPickerPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    signOut.mockReset();
  });

  it('lists one link per membership with access level', async () => {
    apiFetch.mockResolvedValue({
      user,
      memberships: [
        { organizationId: 'o1', organizationName: 'Café Lindenhof', accessLevel: 'EMPLOYEE' },
        { organizationId: 'o2', organizationName: 'Bäckerei Sonne', accessLevel: 'MANAGER' },
      ],
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Café Lindenhof · Employee' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Bäckerei Sonne · Manager' })).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('link', { name: 'Create organisation' })).toHaveAttribute(
      'href',
      '/orgs/new',
    );
  });

  it('shows an empty state without memberships', async () => {
    apiFetch.mockResolvedValue({ user, memberships: [] });
    renderPage();
    expect(await screen.findByText('You are not a member of any organisation yet.')).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('logs out and returns to the login page', async () => {
    apiFetch.mockResolvedValue({ user, memberships: [] });
    signOut.mockResolvedValue({ data: { success: true } });
    const { router, client } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('OrgPickerPage create link', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('offers Create organisation while loading', async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText('Loading…')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create organisation' })).toHaveAttribute(
      'href',
      '/orgs/new',
    );
  });

  it('offers Create organisation after a load error', async () => {
    apiFetch.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create organisation' })).toHaveAttribute(
      'href',
      '/orgs/new',
    );
  });
});
