import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SkillDto } from '@shiftswap/shared';
import { useRef, useState, type FormEvent } from 'react';
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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const skills = useQuery({
    queryKey: ['skills', org.organizationId],
    queryFn: () => apiFetch<SkillDto[]>(orgApi(org, '/skills')),
  });

  /** The confirm group unmounts, so focus the row's Delete button once it is back. */
  function focusDelete(id: string) {
    setTimeout(
      () => (document.getElementById(`delete-skill-${id}`) ?? headingRef.current)?.focus(),
      0,
    );
  }

  /** Focus an element once React has re-rendered the list; falls back to the heading. */
  function focusLater(id: string) {
    setTimeout(() => (document.getElementById(id) ?? headingRef.current)?.focus(), 0);
  }

  async function run(
    work: () => Promise<void>,
    done: string,
    onFail?: () => void,
    focusId?: string,
  ) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ['skills', org.organizationId] });
      setNotice(done);
      if (focusId) focusLater(focusId);
      else headingRef.current?.focus();
    } catch (err) {
      setError(skillError(err));
      onFail?.();
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
    void run(
      async () => {
        await apiSend('PATCH', orgApi(org, `/skills/${id}`), { name: name.trim() });
        setEditing(null);
      },
      'Skill renamed.',
      undefined,
      `rename-skill-${id}`,
    );
  }

  return (
    <section aria-labelledby="skills-heading" className="flex flex-col gap-3">
      <h2
        id="skills-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold outline-none"
      >
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
                    id={`rename-skill-${s.id}`}
                    aria-label={`Rename ${s.name}`}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setEditing({ id: s.id, name: s.name });
                    }}
                  >
                    Rename
                  </Button>
                  {confirming === s.id ? (
                    <span
                      role="group"
                      aria-label={`Confirm deleting ${s.name}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="text-sm">
                        Delete skill {s.name}? It will also be removed from people who have it.
                      </span>
                      <Button
                        className="h-8 px-3"
                        disabled={pending}
                        onClick={() => {
                          setConfirming(null);
                          void run(
                            () => apiSend('DELETE', orgApi(org, `/skills/${s.id}`)),
                            'Skill deleted.',
                            () => focusDelete(s.id),
                            'new-skill',
                          );
                        }}
                      >
                        Yes, delete
                      </Button>
                      <Button
                        variant="outline"
                        className="h-8 px-3"
                        onClick={() => {
                          setConfirming(null);
                          focusDelete(s.id);
                        }}
                      >
                        Keep skill
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-8 px-3"
                      disabled={pending}
                      id={`delete-skill-${s.id}`}
                      aria-label={`Delete ${s.name}`}
                      onClick={() => setConfirming(s.id)}
                    >
                      Delete
                    </Button>
                  )}
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
