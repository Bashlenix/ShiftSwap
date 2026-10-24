import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { renderWithOrg } from '../../test-utils';
import { PreferenceGrid } from './PreferenceGrid';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const PATH = '/api/v1/orgs/org-1/me/preferences';

function group(name: string) {
  return screen.getByRole('group', { name });
}
function radio(name: string, label: string) {
  return within(group(name)).getByRole('radio', { name: label });
}

describe('PreferenceGrid', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
    apiFetch.mockResolvedValue({
      entries: [{ weekday: 1, slot: 'AFTERNOON', value: 'PREFERRED' }],
    });
    apiSend.mockResolvedValue({ entries: [] });
  });

  it('renders 21 labelled radio groups and 63 radios', async () => {
    renderWithOrg(<PreferenceGrid />);
    expect(await screen.findByRole('group', { name: 'Monday morning' })).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(21);
    expect(screen.getAllByRole('radio')).toHaveLength(63);
    expect(screen.getByRole('heading', { name: 'Weekly preferences' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Morning (05–12)' })).toBeVisible();
    expect(screen.getByRole('rowheader', { name: 'Sunday' })).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith(PATH);
  });

  it('selects from the server and defaults absent cells to Neutral', async () => {
    renderWithOrg(<PreferenceGrid />);
    await screen.findByRole('group', { name: 'Tuesday afternoon' });
    await waitFor(() => expect(radio('Tuesday afternoon', 'Preferred')).toBeChecked());
    expect(radio('Monday morning', 'Neutral')).toBeChecked();
  });

  it('keeps Save disabled until something changes', async () => {
    renderWithOrg(<PreferenceGrid />);
    await waitFor(() => expect(radio('Tuesday afternoon', 'Preferred')).toBeChecked());
    const save = screen.getByRole('button', { name: 'Save preferences' });
    expect(save).toBeDisabled();
    await userEvent.click(radio('Monday morning', 'Avoid'));
    expect(save).toBeEnabled();
    await userEvent.click(radio('Monday morning', 'Neutral'));
    expect(save).toBeDisabled();
  });

  it('sends only non-neutral cells, announces success and resets the baseline', async () => {
    const saved = {
      entries: [
        { weekday: 0, slot: 'MORNING', value: 'AVOID' },
        { weekday: 2, slot: 'EVENING', value: 'PREFERRED' },
      ],
    };
    apiSend.mockImplementation(async () => {
      apiFetch.mockResolvedValue(saved); // the refetch after invalidation sees the saved grid
      return saved;
    });
    renderWithOrg(<PreferenceGrid />);
    await waitFor(() => expect(radio('Tuesday afternoon', 'Preferred')).toBeChecked());
    await userEvent.click(radio('Wednesday evening', 'Preferred'));
    await userEvent.click(radio('Monday morning', 'Avoid'));
    await userEvent.click(radio('Tuesday afternoon', 'Neutral'));
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('PUT', PATH, {
        entries: [
          { weekday: 0, slot: 'MORNING', value: 'AVOID' },
          { weekday: 2, slot: 'EVENING', value: 'PREFERRED' },
        ],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Preferences saved.');
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    expect(radio('Monday morning', 'Avoid')).toBeChecked();
  });

  it('shows the error in an alert and keeps the choices', async () => {
    apiSend.mockRejectedValue(new ApiError(500, null));
    renderWithOrg(<PreferenceGrid />);
    await waitFor(() => expect(radio('Tuesday afternoon', 'Preferred')).toBeChecked());
    await userEvent.click(radio('Monday morning', 'Avoid'));
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(radio('Monday morning', 'Avoid')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
  });

  it('sends one PUT on a double click', async () => {
    let release: (v: unknown) => void = () => {};
    apiSend.mockReturnValue(new Promise((r) => (release = r)));
    renderWithOrg(<PreferenceGrid />);
    await waitFor(() => expect(radio('Tuesday afternoon', 'Preferred')).toBeChecked());
    await userEvent.click(radio('Monday morning', 'Avoid'));
    const save = screen.getByRole('button', { name: 'Save preferences' });
    await userEvent.dblClick(save);
    release({ entries: [{ weekday: 0, slot: 'MORNING', value: 'AVOID' }] });
    await screen.findByRole('status');
    expect(apiSend).toHaveBeenCalledTimes(1);
  });
});
