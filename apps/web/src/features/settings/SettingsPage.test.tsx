import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgDto } from '@shiftswap/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { useMe } from '../orgs/useMe';
import { renderWithOrg, TEST_ORG } from '../../test-utils';
import { SettingsPage } from './SettingsPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const ADMIN = { ...TEST_ORG, accessLevel: 'ADMIN' as const };
const orgDto: OrgDto = {
  id: 'org-1',
  name: 'Café Lindenhof',
  timezone: 'Europe/Berlin',
  defaultWeeklyLimitMin: 2400,
  minRestMin: 660,
  maxDailyMin: 600,
  offerLeadTimeMin: 120,
};

function MeProbe() {
  useMe();
  return null;
}

function setup() {
  apiFetch.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/skills') ? [] : orgDto),
  );
  renderWithOrg(
    <>
      <MeProbe />
      <SettingsPage />
    </>,
    ADMIN,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('tells non-admins the page is for admins', () => {
    renderWithOrg(<SettingsPage />, { ...TEST_ORG, accessLevel: 'MANAGER' });
    expect(screen.getByText('Only admins can see this page.')).toBeVisible();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('shows minutes as hours in labelled fields with the policy caption', async () => {
    setup();
    expect(await screen.findByLabelText('Name')).toHaveValue('Café Lindenhof');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Berlin');
    expect(screen.getByLabelText('Weekly hour limit (h)')).toHaveValue(40);
    expect(screen.getByLabelText('Minimum rest between shifts (h)')).toHaveValue(11);
    expect(screen.getByLabelText('Maximum hours per day (h)')).toHaveValue(10);
    expect(screen.getByLabelText('Offer closes before shift start (h)')).toHaveValue(2);
    expect(
      screen.getByText('These are company policy checks, not a legal compliance guarantee.'),
    ).toBeVisible();
  });

  it('sends only changed fields, converted to minutes, and refetches /me', async () => {
    setup();
    apiSend.mockResolvedValue({ ...orgDto, offerLeadTimeMin: 90, minRestMin: 750 });
    const lead = await screen.findByLabelText('Offer closes before shift start (h)');
    await userEvent.clear(lead);
    await userEvent.type(lead, '1.5');
    const rest = screen.getByLabelText('Minimum rest between shifts (h)');
    await userEvent.clear(rest);
    await userEvent.type(rest, '12.5');
    const meCalls = () => apiFetch.mock.calls.filter(([p]) => p === '/api/v1/me').length;
    const before = meCalls();
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1', {
      offerLeadTimeMin: 90,
      minRestMin: 750,
    });
    expect(await screen.findByText('Settings saved.')).toBeVisible();
    await vi.waitFor(() => expect(meCalls()).toBeGreaterThan(before));
  });

  it('changes name and time zone', async () => {
    setup();
    apiSend.mockResolvedValue({ ...orgDto, name: 'Neu', timezone: 'Europe/London' });
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Neu');
    await userEvent.selectOptions(screen.getByLabelText('Time zone'), 'Europe/London');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1', {
      name: 'Neu',
      timezone: 'Europe/London',
    });
  });

  it('sends nothing when nothing changed', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(apiSend).not.toHaveBeenCalled();
    expect(await screen.findByText('No changes to save.')).toBeVisible();
  });

  it('rejects non-numeric hours without calling the API', async () => {
    setup();
    const limit = await screen.findByLabelText('Weekly hour limit (h)');
    await userEvent.clear(limit);
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(apiSend).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a number of hours.');
  });

  it('shows the server validation message', async () => {
    setup();
    apiSend.mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: { issues: [{ path: 'maxDailyMin', message: 'Must be at least 60' }] },
        },
      }),
    );
    await userEvent.type(await screen.findByLabelText('Name'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Must be at least 60');
  });

  it('does not re-send untouched fields whose hour display is rounded', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/skills') ? [] : { ...orgDto, minRestMin: 1235 }),
    );
    apiSend.mockResolvedValue(orgDto);
    renderWithOrg(<SettingsPage />, ADMIN);
    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1', {
      name: 'Café Lindenhof!',
    });
  });

  it.each([
    ['Weekly hour limit (h)', '81', 'Weekly hour limit must be between 1 and 80 hours.'],
    ['Weekly hour limit (h)', '0.5', 'Weekly hour limit must be between 1 and 80 hours.'],
    [
      'Minimum rest between shifts (h)',
      '25',
      'Minimum rest between shifts must be between 0 and 24 hours.',
    ],
    ['Maximum hours per day (h)', '0', 'Maximum hours per day must be between 1 and 24 hours.'],
    ['Maximum hours per day (h)', '25', 'Maximum hours per day must be between 1 and 24 hours.'],
    [
      'Offer closes before shift start (h)',
      '49',
      'Offer closes before shift start must be between 0 and 48 hours.',
    ],
    [
      'Offer closes before shift start (h)',
      '-1',
      'Offer closes before shift start must be between 0 and 48 hours.',
    ],
  ])('blocks %s = %s with an hour message next to the field', async (label, value, message) => {
    setup();
    const input = await screen.findByLabelText(label);
    await userEvent.clear(input);
    await userEvent.type(input, value);
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(apiSend).not.toHaveBeenCalled();
    expect(await screen.findByText(message)).toBeVisible();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(message);
  });

  it('accepts the range limits', async () => {
    setup();
    apiSend.mockResolvedValue(orgDto);
    const input = await screen.findByLabelText('Weekly hour limit (h)');
    await userEvent.clear(input);
    await userEvent.type(input, '80');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1', {
      defaultWeeklyLimitMin: 4800,
    });
  });

  it('diffs against the saved values, not the page-load values', async () => {
    setup();
    apiSend.mockImplementation((_m: string, _p: string, body: { defaultWeeklyLimitMin: number }) =>
      Promise.resolve({ ...orgDto, defaultWeeklyLimitMin: body.defaultWeeklyLimitMin }),
    );
    const input = await screen.findByLabelText('Weekly hour limit (h)');
    for (const v of ['41', '40']) {
      await userEvent.clear(input);
      await userEvent.type(input, v);
      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
      await screen.findByText('Settings saved.');
    }
    expect(apiSend).toHaveBeenNthCalledWith(1, 'PATCH', '/api/v1/orgs/org-1', {
      defaultWeeklyLimitMin: 2460,
    });
    expect(apiSend).toHaveBeenNthCalledWith(2, 'PATCH', '/api/v1/orgs/org-1', {
      defaultWeeklyLimitMin: 2400,
    });
  });

  it('clears a field error when the field is edited', async () => {
    setup();
    const input = await screen.findByLabelText('Weekly hour limit (h)');
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Weekly hour limit must be between 1 and 80 hours.');
    await userEvent.type(input, '1');
    expect(screen.queryByText('Weekly hour limit must be between 1 and 80 hours.')).toBeNull();
  });
});
