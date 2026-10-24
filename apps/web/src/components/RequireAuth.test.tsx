import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';

const useSession = vi.hoisted(() => vi.fn());
vi.mock('../lib/auth-client', () => ({ authClient: { useSession } }));

function renderAt(state: { data: unknown; isPending: boolean; isRefetching: boolean }) {
  useSession.mockReturnValue(state);
  const router = createMemoryRouter(
    [
      { element: <RequireAuth />, children: [{ path: '/orgs', element: <p>orgs page</p> }] },
      { path: '/login', element: <p>login page</p> },
    ],
    { initialEntries: ['/orgs'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('RequireAuth', () => {
  it('waits while a refetch may still pick up a fresh sign-in', () => {
    const router = renderAt({ data: null, isPending: false, isRefetching: true });
    expect(screen.getByText('Loading…')).toBeVisible();
    expect(router.state.location.pathname).toBe('/orgs');
  });

  it('sends a settled signed-out user to /login', () => {
    const router = renderAt({ data: null, isPending: false, isRefetching: false });
    expect(screen.getByText('login page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('renders the route for a signed-in user, even while refetching', () => {
    renderAt({ data: { user: { id: 'u1' } }, isPending: false, isRefetching: true });
    expect(screen.getByText('orgs page')).toBeVisible();
  });
});
