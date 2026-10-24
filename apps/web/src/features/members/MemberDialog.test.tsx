import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberDto } from '@shiftswap/shared';
import { ApiError } from '../../lib/api';
import { MANAGER_ORG, renderWithOrg, TEST_ORG } from '../../test-utils';
import { MemberDialog } from './MemberDialog';

const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiSend,
}));

const skills = [{ id: 'sk1', name: 'Barista' }];
const member = (extra: Partial<MemberDto> = {}): MemberDto => ({
  id: 'm1',
  displayName: 'Anna Beck',
  accessLevel: 'EMPLOYEE',
  email: 'anna@example.com',
  status: 'ACTIVE',
  hasLogin: true,
  invitePending: false,
  skillIds: ['sk1'],
  weeklyLimitMin: 1230,
  ...extra,
});

function open(target: MemberDto | null = null, org = MANAGER_ORG) {
  const onClose = vi.fn();
  renderWithOrg(<MemberDialog open member={target} skills={skills} onClose={onClose} />, org);
  return onClose;
}

describe('MemberDialog', () => {
  beforeEach(() => {
    apiSend.mockReset();
  });

  it('has labelled fields and the email hint', () => {
    open();
    expect(screen.getByLabelText('Name')).toBeVisible();
    expect(screen.getByLabelText(/^Email/)).toHaveAccessibleDescription(
      'Leave empty for staff without email (no login)',
    );
    expect(screen.getByLabelText('Access level')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Barista' })).toBeVisible();
    expect(screen.getByLabelText(/Weekly limit/)).toBeVisible();
  });

  it('hides the Admin option from managers and shows it to admins', () => {
    open();
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the Admin option to admins', () => {
    open(null, { ...TEST_ORG, accessLevel: 'ADMIN' });
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
  });

  it('adds a placeholder without an email', async () => {
    apiSend.mockResolvedValue({ member: member({ email: null }), inviteLink: null });
    const onClose = open();
    await userEvent.type(screen.getByLabelText('Name'), 'Tom');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/members', {
      displayName: 'Tom',
      accessLevel: 'EMPLOYEE',
      skillIds: [],
      appOrigin: window.location.origin,
    });
    expect(onClose).toHaveBeenCalledWith({ notice: 'Tom added.' });
  });

  it('adds with an email, hours converted to minutes, and hands over the invite', async () => {
    apiSend.mockResolvedValue({ member: member(), inviteLink: 'http://x/invite/abc' });
    const onClose = open();
    await userEvent.type(screen.getByLabelText('Name'), 'Anna');
    await userEvent.type(screen.getByLabelText(/^Email/), 'anna@example.com');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Barista' }));
    await userEvent.type(screen.getByLabelText(/Weekly limit/), '20.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(apiSend.mock.calls[0][2]).toMatchObject({
      email: 'anna@example.com',
      skillIds: ['sk1'],
      weeklyLimitMin: 1230,
    });
    expect(onClose).toHaveBeenCalledWith({
      invite: { email: 'anna@example.com', link: 'http://x/invite/abc' },
    });
  });

  it('shows the server message for a deactivated email', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'ALREADY_MEMBER', message: 'This person is deactivated. Reactivate them.' },
      }),
    );
    open();
    await userEvent.type(screen.getByLabelText('Name'), 'Anna');
    await userEvent.type(screen.getByLabelText(/^Email/), 'anna@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This person is deactivated. Reactivate them.',
    );
  });

  it('edits: sends only changed fields; empty limit clears to the org default', async () => {
    apiSend.mockResolvedValue(member());
    const onClose = open(member());
    expect(screen.getByLabelText(/Weekly limit/)).toHaveValue(20.5);
    await userEvent.clear(screen.getByLabelText(/Weekly limit/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ notice: 'Changes saved.' }));
    expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1/members/m1', {
      weeklyLimitMin: null,
    });
  });

  it('blocks managers from changing an admin access level', () => {
    open(member({ accessLevel: 'ADMIN' }));
    expect(screen.getByLabelText('Access level')).toBeDisabled();
    expect(screen.getByText('Only admins can change this.')).toBeVisible();
  });

  it('shows LAST_ADMIN copy', async () => {
    apiSend.mockImplementation(() =>
      Promise.reject(new ApiError(409, { error: { code: 'LAST_ADMIN', message: 'x' } })),
    );
    open(member({ accessLevel: 'ADMIN' }), { ...TEST_ORG, accessLevel: 'ADMIN' });
    await userEvent.selectOptions(screen.getByLabelText('Access level'), 'EMPLOYEE');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An organisation needs at least one admin.',
    );
  });
});
