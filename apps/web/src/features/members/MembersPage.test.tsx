import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberDto } from '@shiftswap/shared';
import { ApiError } from '../../lib/api';
import { MANAGER_ORG, renderWithOrg, TEST_ORG } from '../../test-utils';
import { MembersPage } from './MembersPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const m = (id: string, name: string, extra: Partial<MemberDto> = {}): MemberDto => ({
  id,
  displayName: name,
  accessLevel: 'EMPLOYEE',
  email: `${id}@example.com`,
  status: 'ACTIVE',
  hasLogin: true,
  invitePending: false,
  skillIds: ['sk1'],
  weeklyLimitMin: null,
  ...extra,
});

const people = [
  m('mem-1', 'Maria Self', { accessLevel: 'MANAGER' }),
  m('m2', 'Anna Beck', { weeklyLimitMin: 1200 }),
  m('m3', 'Ben Invited', { hasLogin: false, invitePending: true }),
  m('m4', 'Tom Placeholder', { hasLogin: false, email: null, skillIds: [] }),
  m('m5', 'Dora Gone', { status: 'DEACTIVATED' }),
];

function setup(org = MANAGER_ORG) {
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/skills')) return Promise.resolve([{ id: 'sk1', name: 'Barista' }]);
    if (path.includes('status=all')) return Promise.resolve(people);
    return Promise.resolve(people.filter((p) => p.status === 'ACTIVE'));
  });
  renderWithOrg(<MembersPage />, org);
}

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('MembersPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('tells employees the page is for managers', () => {
    setup(TEST_ORG);
    expect(screen.getByText('Only managers can see this page.')).toBeVisible();
  });

  it('renders an accessible table with status badges', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'People in Café Lindenhof' });
    for (const h of ['Name', 'Access', 'Skills', 'Weekly limit', 'Status'])
      expect(within(table).getByRole('columnheader', { name: h })).toBeVisible();
    expect(within(rowOf('Anna Beck')).getByText('Active')).toBeVisible();
    expect(within(rowOf('Anna Beck')).getByText('20 h')).toBeVisible();
    expect(within(rowOf('Ben Invited')).getByText('Invite pending')).toBeVisible();
    expect(within(rowOf('Tom Placeholder')).getByText('No login')).toBeVisible();
    expect(screen.queryByText('Dora Gone')).not.toBeInTheDocument();
  });

  it('shows deactivated people when asked', async () => {
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show deactivated' }));
    const row = await screen.findByRole('row', { name: /Dora Gone/ });
    expect(within(row).getByText('Deactivated')).toBeVisible();
    expect(within(row).getByRole('button', { name: /Reactivate/ })).toBeVisible();
    expect(within(row).queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
  });

  it('offers the right row actions', async () => {
    setup();
    await screen.findByRole('table');
    expect(
      within(rowOf('Ben Invited')).getByRole('button', { name: /Resend invite/ }),
    ).toBeVisible();
    expect(within(rowOf('Anna Beck')).queryByRole('button', { name: /Resend invite/ })).toBeNull();
    // No self-deactivation.
    expect(within(rowOf('Maria Self')).getByRole('button', { name: /Edit/ })).toBeVisible();
    expect(within(rowOf('Maria Self')).queryByRole('button', { name: /Deactivate/ })).toBeNull();
  });

  it('adds a person with email, shows the invite and announces the copy', async () => {
    apiSend.mockResolvedValue({
      member: m('m6', 'Neu', { email: 'neu@example.com', hasLogin: false, invitePending: true }),
      inviteLink: 'http://localhost/invite/tok',
    });
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Neu');
    await userEvent.type(screen.getByLabelText(/^Email/), 'neu@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByText('Invite sent to neu@example.com.')).toBeVisible();
    const demo = screen.getByRole('link', { name: 'Open demo inbox' });
    expect(demo).toHaveAttribute('href', '/mailpit/');
    expect(demo).toHaveAttribute('target', '_blank');
    expect(demo).toHaveAttribute('rel', 'noopener');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost/invite/tok');
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
  });

  it('resends an invite', async () => {
    apiSend.mockResolvedValue({ inviteLink: 'http://localhost/invite/new' });
    setup();
    await screen.findByRole('table');
    await userEvent.click(
      within(rowOf('Ben Invited')).getByRole('button', { name: /Resend invite/ }),
    );
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/members/m3/invite', {
      appOrigin: window.location.origin,
    });
    expect(await screen.findByText('Invite sent to m3@example.com.')).toBeVisible();
  });

  it.each([
    [2, 'Deactivated. 2 future shifts were posted as open shifts.'],
    [1, 'Deactivated. 1 future shift was posted as an open shift.'],
    [0, 'Deactivated.'],
  ])('deactivates after confirming (%i reposted)', async (reposted, notice) => {
    apiSend.mockResolvedValue({
      cancelledOffers: 0,
      reposted,
      unassigned: reposted,
      withdrawnAcceptances: 0,
    });
    setup();
    await screen.findByRole('table');
    await userEvent.click(within(rowOf('Anna Beck')).getByRole('button', { name: /Deactivate/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Their open offers are cancelled and their future shifts become open shifts.',
      ),
    ).toBeVisible();
    expect(apiSend).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/members/m2/deactivate');
    expect(screen.getByText(notice)).toBeVisible();
  });

  it('shows LAST_ADMIN when deactivation is refused', async () => {
    apiSend.mockRejectedValue(new ApiError(409, { error: { code: 'LAST_ADMIN', message: 'x' } }));
    setup();
    await screen.findByRole('table');
    await userEvent.click(within(rowOf('Anna Beck')).getByRole('button', { name: /Deactivate/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, deactivate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An organisation needs at least one admin.',
    );
  });

  it('reactivates', async () => {
    apiSend.mockResolvedValue(m('m5', 'Dora Gone'));
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show deactivated' }));
    await userEvent.click(
      within(await screen.findByRole('row', { name: /Dora Gone/ })).getByRole('button', {
        name: /Reactivate/,
      }),
    );
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/members/m5/reactivate');
    expect(await screen.findByText('Dora Gone reactivated.')).toBeVisible();
  });
});
