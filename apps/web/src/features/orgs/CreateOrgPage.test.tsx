import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { CreateOrgPage } from './CreateOrgPage';

const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiSend,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const router = createMemoryRouter(
    [
      { path: '/orgs/new', element: <CreateOrgPage /> },
      { path: '/orgs/:id', element: <p>org detail</p> },
    ],
    { initialEntries: ['/orgs/new'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, invalidate };
}

describe('CreateOrgPage', () => {
  beforeEach(() => {
    apiSend.mockReset();
  });

  it('defaults the time zone to a valid value', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Create organisation' })).toBeVisible();
    const tz = (screen.getByLabelText('Time zone') as HTMLInputElement).value;
    // CI runs in UTC (no slash), so only require a zone Intl accepts.
    expect(tz).not.toBe('');
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: tz })).not.toThrow();
  });

  it('creates the org, invalidates /me and navigates to it', async () => {
    apiSend.mockResolvedValue({ id: 'new-org' });
    const { router, invalidate } = renderPage();
    await userEvent.type(screen.getByLabelText('Name'), '  Café Neu ');
    await userEvent.clear(screen.getByLabelText('Time zone'));
    await userEvent.type(screen.getByLabelText('Time zone'), 'Europe/Berlin');
    await userEvent.click(screen.getByRole('button', { name: 'Create organisation' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/new-org'));
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs', {
      name: 'Café Neu',
      timezone: 'Europe/Berlin',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  it('validates name and zone, focusing the first error', async () => {
    renderPage();
    await userEvent.clear(screen.getByLabelText('Time zone'));
    await userEvent.type(screen.getByLabelText('Time zone'), 'Mars/Olympus');
    await userEvent.click(screen.getByRole('button', { name: 'Create organisation' }));
    expect(await screen.findByText('Enter a name')).toBeVisible();
    expect(screen.getByText('Enter a valid time zone, e.g. Europe/Berlin')).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('shows the server error', async () => {
    apiSend.mockRejectedValue(new ApiError(429, { error: { code: 'RATE_LIMITED' } as never }));
    renderPage();
    await userEvent.type(screen.getByLabelText('Name'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Create organisation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests.');
  });
});
