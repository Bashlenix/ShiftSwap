import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Some tests replace navigator.clipboard; put the original back so no stub leaks.
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

describe('MembersPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
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

  const bodyNames = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => (within(r).getAllByRole('rowheader')[0]?.textContent ?? '').slice(0, 5));

  it('filters rows by search and updates the count', async () => {
    setup();
    await screen.findByRole('table');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 4 of 4 members');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'barista');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 4 members');
    expect(screen.queryByText('Tom Placeholder')).not.toBeInTheDocument();
    expect(screen.getByText('Anna Beck')).toBeVisible();
  });

  it('shows one row when nothing matches', async () => {
    setup();
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'zzz');
    expect(screen.getByText('No members match "zzz".')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 0 of 4 members');
  });

  it('sorts by a column button and toggles direction', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/skills')
          ? [{ id: 'sk1', name: 'Barista' }]
          : [
              m('mem-1', 'Maria Self', { weeklyLimitMin: 600 }),
              m('m2', 'Anna Beck', { weeklyLimitMin: 1200 }),
              m('m3', 'Ben Null'),
            ],
      ),
    );
    renderWithOrg(<MembersPage />, MANAGER_ORG);
    await screen.findByRole('table');
    const header = (n: string) => screen.getByRole('columnheader', { name: n });
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Weekly limit')).toHaveAttribute('aria-sort', 'none');
    expect(bodyNames()).toEqual(['Anna ', 'Ben N', 'Maria']);
    const button = within(header('Weekly limit')).getByRole('button', { name: 'Weekly limit' });
    await userEvent.click(button);
    expect(header('Weekly limit')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Name')).toHaveAttribute('aria-sort', 'none');
    expect(bodyNames()).toEqual(['Maria', 'Anna ', 'Ben N']);
    await userEvent.click(button);
    expect(header('Weekly limit')).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Anna ', 'Maria', 'Ben N']);
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

  it('offers Invite (not Resend) for a login-less placeholder without email', async () => {
    setup();
    await screen.findByRole('table');
    const row = rowOf('Tom Placeholder');
    expect(within(row).getByRole('button', { name: 'Invite Tom Placeholder' })).toBeVisible();
    expect(within(row).queryByRole('button', { name: /Resend invite/ })).toBeNull();
    expect(within(rowOf('Anna Beck')).queryByRole('button', { name: /^Invite / })).toBeNull();
    expect(within(rowOf('Ben Invited')).queryByRole('button', { name: /^Invite / })).toBeNull();
  });

  it('invites a placeholder by email from a dialog and shows the link', async () => {
    apiSend.mockResolvedValue({ inviteLink: 'http://localhost/invite/tom' });
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite Tom Placeholder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite Tom Placeholder' });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'tom@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/members/m4/invite', {
      email: 'tom@example.com',
      appOrigin: window.location.origin,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Invite sent to tom@example.com.')).toBeVisible();
    expect(screen.getByDisplayValue('http://localhost/invite/tom')).toBeVisible();
  });

  it('keeps the invite dialog open with the error when the email is taken', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'ALREADY_MEMBER', message: 'This person is already a member.' },
      }),
    );
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite Tom Placeholder' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'anna@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This person is already a member.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('closes the invite dialog when the refreshed member already has an email', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'INVALID_TRANSITION', message: 'Already invited elsewhere.' },
      }),
    );
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite Tom Placeholder' }));
    const dialog = await screen.findByRole('dialog');
    // Someone else invited Tom meanwhile: the refreshed list now has his email.
    apiFetch.mockImplementation((path: string) => {
      if (path.includes('/skills')) return Promise.resolve([{ id: 'sk1', name: 'Barista' }]);
      return Promise.resolve(
        people
          .filter((p) => p.status === 'ACTIVE')
          .map((p) =>
            p.id === 'm4' ? { ...p, email: 'tom@example.com', invitePending: true } : p,
          ),
      );
    });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'tom@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancels the invite dialog without a request', async () => {
    setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite Tom Placeholder' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiSend).not.toHaveBeenCalled();
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

  it('offers Resend invite for an expired invite (email, no login, nothing pending)', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/skills')
          ? []
          : [m('m7', 'Expired Eve', { hasLogin: false, invitePending: false })],
      ),
    );
    renderWithOrg(<MembersPage />, MANAGER_ORG);
    await screen.findByRole('table');
    expect(within(rowOf('Expired Eve')).getByText('No login')).toBeVisible();
    expect(
      within(rowOf('Expired Eve')).getByRole('button', { name: /Resend invite/ }),
    ).toBeVisible();
  });

  it('clears the previous invite at the start of a resend', async () => {
    let finish: (v: unknown) => void = () => {};
    apiSend.mockResolvedValueOnce({ inviteLink: 'http://localhost/invite/one' });
    setup();
    await screen.findByRole('table');
    await userEvent.click(
      within(rowOf('Ben Invited')).getByRole('button', { name: /Resend invite/ }),
    );
    expect(await screen.findByDisplayValue('http://localhost/invite/one')).toBeVisible();
    apiSend.mockReturnValueOnce(new Promise((r) => (finish = r)));
    await userEvent.click(
      within(rowOf('Ben Invited')).getByRole('button', { name: /Resend invite/ }),
    );
    expect(screen.queryByDisplayValue('http://localhost/invite/one')).not.toBeInTheDocument();
    finish({ inviteLink: 'http://localhost/invite/two' });
    expect(await screen.findByDisplayValue('http://localhost/invite/two')).toBeVisible();
  });

  it('shows an error and keeps the link selectable when copying is impossible', async () => {
    apiSend.mockResolvedValue({ inviteLink: 'http://localhost/invite/one' });
    setup();
    await screen.findByRole('table');
    await userEvent.click(
      within(rowOf('Ben Invited')).getByRole('button', { name: /Resend invite/ }),
    );
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy invite link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy the link');
    expect(screen.getByDisplayValue('http://localhost/invite/one')).toHaveAttribute('readonly');
  });

  it('uses the member wording and refreshes on INVALID_TRANSITION', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, { error: { code: 'INVALID_TRANSITION', message: 'x' } }),
    );
    setup();
    await screen.findByRole('table');
    const before = apiFetch.mock.calls.length;
    await userEvent.click(
      within(rowOf('Ben Invited')).getByRole('button', { name: /Resend invite/ }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This person's status changed. The list has been refreshed.",
    );
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(before));
  });

  // Runs last (file order): the stubs from the copy tests above were put back.
  it('leaves navigator.clipboard as it found it', () => {
    expect(Object.getOwnPropertyDescriptor(navigator, 'clipboard')).toEqual(originalClipboard);
  });
});
