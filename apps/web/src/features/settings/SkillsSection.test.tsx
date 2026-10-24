import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { renderWithOrg, TEST_ORG } from '../../test-utils';
import { SkillsSection } from './SkillsSection';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

function setup() {
  apiFetch.mockResolvedValue([
    { id: 's1', name: 'Barista' },
    { id: 's2', name: 'Kitchen' },
  ]);
  renderWithOrg(<SkillsSection />, { ...TEST_ORG, accessLevel: 'ADMIN' });
}

const conflict = (code: string, details?: Record<string, unknown>, message = 'x') =>
  new ApiError(409, { error: { code: code as never, message, details } });

describe('SkillsSection', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('lists skills', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Skills' });
    expect(within(list).getByText('Barista')).toBeVisible();
    expect(within(list).getByText('Kitchen')).toBeVisible();
  });

  it('adds a skill', async () => {
    setup();
    apiSend.mockResolvedValue({ id: 's3', name: 'Bar' });
    await userEvent.type(await screen.findByLabelText('New skill name'), '  Bar ');
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/skills', { name: 'Bar' });
    expect(await screen.findByText('Skill added.')).toBeVisible();
  });

  it('shows the server message for a duplicate name', async () => {
    setup();
    apiSend.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'VALIDATION_FAILED', message: 'A skill with this name already exists' },
      }),
    );
    await userEvent.type(await screen.findByLabelText('New skill name'), 'barista');
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A skill with this name already exists',
    );
  });

  it('renames inline', async () => {
    setup();
    apiSend.mockResolvedValue({ id: 's1', name: 'Barista II' });
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Barista' }));
    const input = screen.getByLabelText('New name for Barista');
    await userEvent.clear(input);
    await userEvent.type(input, 'Barista II');
    await userEvent.click(screen.getByRole('button', { name: 'Save name for Barista' }));
    expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1/skills/s1', {
      name: 'Barista II',
    });
    expect(await screen.findByText('Skill renamed.')).toBeVisible();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rename Barista' })).toHaveFocus(),
    );
  });

  it('cancels a rename', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Barista' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel renaming Barista' }));
    expect(screen.queryByLabelText('New name for Barista')).toBeNull();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('deletes a skill', async () => {
    setup();
    apiSend.mockResolvedValue(undefined);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Kitchen' }));
    expect(
      screen.getByText('Delete skill Kitchen? It will also be removed from people who have it.'),
    ).toBeVisible();
    expect(apiSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(apiSend).toHaveBeenCalledWith('DELETE', '/api/v1/orgs/org-1/skills/s2');
    expect(await screen.findByText('Skill deleted.')).toBeVisible();
    await vi.waitFor(() => expect(screen.getByLabelText('New skill name')).toHaveFocus());
  });

  it('keeps the skill when delete is not confirmed', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Kitchen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep skill' }));
    expect(apiSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete Kitchen' })).toBeVisible();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Kitchen' })).toHaveFocus(),
    );
  });

  it.each([
    [{ shiftCount: 3 }, 'This skill is still required by 3 upcoming shifts.'],
    [{ shiftCount: 1 }, 'This skill is still required by 1 upcoming shift.'],
    [undefined, 'This skill is still required by upcoming shifts.'],
  ])('explains a skill in use (%j)', async (details, text) => {
    setup();
    apiSend.mockRejectedValue(conflict('SKILL_IN_USE', details));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Kitchen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Kitchen' })).toHaveFocus(),
    );
  });
});
