import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgPickerPage } from './OrgPickerPage';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrgPickerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const user = { id: 'u1', email: 'a@b.test', name: 'Anna' };

describe('OrgPickerPage', () => {
  beforeEach(() => apiFetch.mockReset());

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
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('shows an empty state without memberships', async () => {
    apiFetch.mockResolvedValue({ user, memberships: [] });
    renderPage();
    expect(await screen.findByText('You are not a member of any organisation yet.')).toBeVisible();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
