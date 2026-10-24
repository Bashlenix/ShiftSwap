import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgLayout } from './OrgLayout';
import { useOrg } from './useOrg';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

const me = {
  user: { id: 'u1', email: 'a@b.test', name: 'Anna' },
  memberships: [
    {
      membershipId: 'm1',
      organizationId: 'o1',
      organizationName: 'Café Lindenhof',
      accessLevel: 'EMPLOYEE',
      organizationTimezone: 'Europe/Berlin',
    },
  ],
};

function Probe() {
  const org = useOrg();
  return <p>tz {org.timezone}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/orgs/:orgId',
        element: <OrgLayout />,
        children: [
          { path: 'me/shifts', element: <Probe /> },
          { path: 'offers', element: <p>offers page</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('OrgLayout', () => {
  beforeEach(() => apiFetch.mockReset());

  it('shows Organisation not found for an org the user is not a member of', async () => {
    apiFetch.mockResolvedValue(me);
    renderAt('/orgs/other/me/shifts');
    expect(await screen.findByText('Organisation not found')).toBeVisible();
    expect(screen.queryByText(/tz /)).toBeNull();
  });

  it('renders nav, org name and provides org info to children', async () => {
    apiFetch.mockResolvedValue(me);
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByText('tz Europe/Berlin')).toBeVisible();
    expect(screen.getByText('Café Lindenhof')).toBeVisible();
    expect(screen.getByRole('link', { name: 'My shifts' })).toHaveAttribute(
      'href',
      '/orgs/o1/me/shifts',
    );
    expect(screen.getByRole('link', { name: 'Open offers' })).toHaveAttribute(
      'href',
      '/orgs/o1/offers',
    );
    expect(screen.getByRole('link', { name: 'Availability' })).toHaveAttribute(
      'href',
      '/orgs/o1/me/availability',
    );
    expect(screen.getByRole('link', { name: 'Switch organisation' })).toHaveAttribute(
      'href',
      '/orgs',
    );
    expect(screen.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  it('hides the manager links from employees and shows them to managers', async () => {
    apiFetch.mockResolvedValue(me);
    renderAt('/orgs/o1/me/shifts');
    await screen.findByText('tz Europe/Berlin');
    expect(screen.queryByRole('link', { name: 'Schedule' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Offer review' })).toBeNull();
  });

  it('shows Schedule and Offer review to managers', async () => {
    apiFetch.mockResolvedValue({
      ...me,
      memberships: [{ ...me.memberships[0], accessLevel: 'MANAGER' }],
    });
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByRole('link', { name: 'Schedule' })).toHaveAttribute(
      'href',
      '/orgs/o1/schedule',
    );
    expect(screen.getByRole('link', { name: 'Offer review' })).toHaveAttribute(
      'href',
      '/orgs/o1/review',
    );
  });
});
