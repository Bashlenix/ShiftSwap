import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditEntryDto } from '@shiftswap/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MANAGER_ORG, renderWithOrg, TEST_ORG } from '../../test-utils';
import { AuditPage } from './AuditPage';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
}));

const entry = (id: string, over: Partial<AuditEntryDto> = {}): AuditEntryDto => ({
  id,
  action: 'offer.approved',
  entityType: 'offer',
  entityId: '12345678-aaaa-bbbb-cccc-1234567890ab',
  actorName: 'Maria Manager',
  before: null,
  after: null,
  metadata: null,
  createdAt: '2026-10-24T12:05:00Z',
  ...over,
});

describe('AuditPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('tells employees the page is for managers', () => {
    renderWithOrg(<AuditPage />, TEST_ORG);
    expect(screen.getByText('Only managers can see this page.')).toBeVisible();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('renders the table', async () => {
    apiFetch.mockResolvedValue({
      items: [
        entry('2'),
        entry('1', { actorName: null, action: 'shift.created', entityType: 'shift' }),
      ],
      nextCursor: null,
    });
    renderWithOrg(<AuditPage />, MANAGER_ORG);
    const table = await screen.findByRole('table', { name: 'Audit log' });
    for (const h of ['When', 'Who', 'Action', 'Item'])
      expect(within(table).getByRole('columnheader', { name: h })).toBeVisible();
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('Sat 24 Oct, 14:05')).toBeVisible();
    expect(within(rows[1]).getByText('Maria Manager')).toBeVisible();
    expect(within(rows[1]).getByText('offer.approved')).toBeVisible();
    expect(within(rows[1]).getByText('offer 12345678')).toBeVisible();
    expect(within(rows[2]).getByText('System')).toBeVisible();
  });

  it('filters by entity type', async () => {
    apiFetch.mockResolvedValue({ items: [entry('1')], nextCursor: null });
    renderWithOrg(<AuditPage />, MANAGER_ORG);
    await screen.findByRole('table');
    const select = screen.getByRole('combobox', { name: 'Item type' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'All types',
      'acceptance',
      'invite',
      'membership',
      'offer',
      'organization',
      'shift',
      'skill',
      'unavailability',
    ]);
    await userEvent.selectOptions(select, 'skill');
    await vi.waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/v1/orgs/org-1/audit?entityType=skill'),
      ),
    );
  });

  it('loads more and appends', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('cursor=9')
          ? { items: [entry('8', { action: 'skill.deleted' })], nextCursor: null }
          : { items: [entry('9')], nextCursor: '9' },
      ),
    );
    renderWithOrg(<AuditPage />, MANAGER_ORG);
    await screen.findByText('offer.approved');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('skill.deleted')).toBeVisible();
    expect(screen.getByText('offer.approved')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows an error when loading fails', async () => {
    apiFetch.mockRejectedValue(new Error('x'));
    renderWithOrg(<AuditPage />, MANAGER_ORG);
    expect(
      await screen.findByText('Could not load the audit log. Please try again.'),
    ).toBeVisible();
  });
});
