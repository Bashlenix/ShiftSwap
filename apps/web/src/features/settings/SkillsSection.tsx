import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SkillDto } from '@shiftswap/shared';
import { useState, type FormEvent } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ApiError, apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { orgApi, useOrg } from '../org/useOrg';

/** A duplicate name arrives as VALIDATION_FAILED with a useful server message and no issues. */
function skillError(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.code === 'VALIDATION_FAILED' &&
    !err.details?.issues &&
    err.serverMessage
  )
    return err.serverMessage;
  return errorMessage(err);
}

export function SkillsSection() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const skills = useQuery({
    queryKey: ['skills', org.organizationId],
    queryFn: () => apiFetch<SkillDto[]>(orgApi(org, '/skills')),
  });

  async function run(work: () => Promise<void>, done: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['skills', org.organizationId] });
      setNotice(done);
    } catch (err) {
      setError(skillError(err));
    } finally {
      setPending(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await apiSend('POST', orgApi(org, '/skills'), { name: newName.trim() });
      setNewName('');
    }, 'Skill added.');
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { id, name } = editing;
    void run(async () => {
      await apiSend('PATCH', orgApi(org, `/skills/${id}`), { name: name.trim() });
      setEditing(null);
    }, 'Skill renamed.');
  }

  return (
    <section aria-labelledby="skills-heading" className="flex flex-col gap-3">
      <h2 id="skills-heading" className="text-xl font-semibold">
        Skills
      </h2>
      <Feedback error={error} notice={notice} />
      {skills.isError && <p role="alert">Could not load the skills. Please try again.</p>}
      {skills.isPending && <p>Loading…</p>}
      {skills.data && skills.data.length === 0 && <p>No skills yet.</p>}
      {skills.data && skills.data.length > 0 && (
        <ul aria-label="Skills" className="flex flex-col gap-2">
          {skills.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              {editing?.id === s.id ? (
                <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`New name for ${s.name}`}
                    className="w-56"
                    maxLength={40}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                  />
                  <Button
                    type="submit"
                    className="h-8 px-3"
                    disabled={pending}
                    aria-label={`Save name for ${s.name}`}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3"
                    aria-label={`Cancel renaming ${s.name}`}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-40">{s.name}</span>
                  <Button
                    variant="outline"
                    className="h-8 px-3"
                    disabled={pending}
                    aria-label={`Rename ${s.name}`}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setEditing({ id: s.id, name: s.name });
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 px-3"
                    disabled={pending}
                    aria-label={`Delete ${s.name}`}
                    onClick={() =>
                      void run(
                        () => apiSend('DELETE', orgApi(org, `/skills/${s.id}`)),
                        'Skill deleted.',
                      )
                    }
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="new-skill" className="text-sm font-medium">
            New skill name
          </label>
          <Input
            id="new-skill"
            className="w-56"
            maxLength={40}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || newName.trim() === ''}>
          Add skill
        </Button>
      </form>
    </section>
  );
}
