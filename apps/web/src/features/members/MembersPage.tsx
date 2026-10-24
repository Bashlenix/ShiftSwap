import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessLevel, DeactivationResult, MemberDto, SkillDto } from '@shiftswap/shared';
import { useRef, useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { orgApi, useOrg } from '../org/useOrg';
import { useSkillNames } from '../org/useSkillNames';
import { InviteResult } from './InviteResult';
import { MemberDialog, type MemberDialogResult } from './MemberDialog';

const ACCESS_LABEL: Record<AccessLevel, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

type Badge = { label: string; symbol: string; tone: string };

function badgeFor(m: MemberDto): Badge {
  if (m.status === 'DEACTIVATED')
    return {
      label: 'Deactivated',
      symbol: '–',
      tone: 'border-slate-300 bg-slate-50 text-slate-800',
    };
  if (m.invitePending)
    return {
      label: 'Invite pending',
      symbol: '…',
      tone: 'border-amber-300 bg-amber-50 text-amber-900',
    };
  if (!m.hasLogin)
    return { label: 'No login', symbol: '○', tone: 'border-slate-300 bg-slate-50 text-slate-800' };
  return { label: 'Active', symbol: '✓', tone: 'border-green-300 bg-green-50 text-green-900' };
}

const hoursText = (min: number | null) =>
  min === null ? 'Org default' : `${Math.round(min / 6) / 10} h`;

function deactivatedNotice(r: DeactivationResult): string {
  if (r.reposted === 0) return 'Deactivated.';
  return r.reposted === 1
    ? 'Deactivated. 1 future shift was posted as an open shift.'
    : `Deactivated. ${r.reposted} future shifts were posted as open shifts.`;
}

export function MembersPage() {
  const org = useOrg();
  if (org.accessLevel === 'EMPLOYEE') return <p>Only managers can see this page.</p>;
  return <MembersTable />;
}

function MembersTable() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const skillNames = useSkillNames();
  const [showAll, setShowAll] = useState(false);
  const [dialog, setDialog] = useState<{ member: MemberDto | null } | null>(null);
  const [confirming, setConfirming] = useState<MemberDto | null>(null);
  const [invite, setInvite] = useState<{ email: string; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const inviteRef = useRef<HTMLParagraphElement>(null);
  const opener = useRef<Element | null>(null);
  const focusTarget = useRef<'feedback' | 'invite' | 'opener'>('opener');

  const status = showAll ? 'all' : 'active';
  const members = useQuery({
    queryKey: ['members', org.organizationId, status],
    queryFn: () => apiFetch<MemberDto[]>(orgApi(org, `/members?status=${status}`)),
  });
  const skills = useQuery({
    queryKey: ['skills', org.organizationId],
    queryFn: () => apiFetch<SkillDto[]>(orgApi(org, '/skills')),
    staleTime: 5 * 60_000,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members', org.organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
    ]);

  function remember() {
    opener.current = document.activeElement;
    setError(null);
    setNotice(null);
  }

  function afterClose() {
    const target = focusTarget.current;
    if (target === 'invite' && inviteRef.current) inviteRef.current.focus();
    else if (target === 'feedback') feedbackRef.current?.focus();
    else if (opener.current instanceof HTMLElement && opener.current.isConnected)
      opener.current.focus();
    focusTarget.current = 'opener';
  }

  function closeDialog(result?: MemberDialogResult) {
    if (result?.invite) {
      setInvite(result.invite);
      focusTarget.current = 'invite';
    } else if (result?.notice) {
      setInvite(null);
      setNotice(result.notice);
      focusTarget.current = 'feedback';
    }
    setDialog(null);
  }

  /** Runs a row action; announces the outcome and moves focus to it. */
  async function act(work: () => Promise<string | null>, afterDone?: () => void) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      await refresh();
      if (message) setNotice(message);
    } catch (err) {
      await refresh();
      setError(errorMessage(err));
    } finally {
      setPending(false);
      afterDone?.();
    }
  }

  function resend(m: MemberDto) {
    remember();
    void act(
      async () => {
        const res = await apiSend<{ inviteLink: string }>(
          'POST',
          orgApi(org, `/members/${m.id}/invite`),
          {
            appOrigin: window.location.origin,
          },
        );
        setInvite({ email: m.email ?? '', link: res.inviteLink });
        return null;
      },
      () => setTimeout(() => inviteRef.current?.focus(), 0),
    );
  }

  function reactivate(m: MemberDto) {
    remember();
    void act(
      async () => {
        await apiSend('POST', orgApi(org, `/members/${m.id}/reactivate`));
        return `${m.displayName} reactivated.`;
      },
      () => feedbackRef.current?.focus(),
    );
  }

  function deactivate(m: MemberDto) {
    void act(
      async () => {
        const res = await apiSend<DeactivationResult>(
          'POST',
          orgApi(org, `/members/${m.id}/deactivate`),
        );
        return deactivatedNotice(res);
      },
      () => {
        focusTarget.current = 'feedback';
        setConfirming(null);
      },
    );
  }

  const btn = 'h-8 px-3';

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="members-heading" className="text-2xl font-semibold">
          Members
        </h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show deactivated
        </label>
        <Button
          className="ml-auto"
          onClick={() => {
            remember();
            setInvite(null);
            setDialog({ member: null });
          }}
        >
          Add person
        </Button>
      </div>
      <Feedback error={error} notice={notice} containerRef={feedbackRef} />
      {invite && <InviteResult email={invite.email} link={invite.link} containerRef={inviteRef} />}
      {members.isError && <p role="alert">Could not load the members. Please try again.</p>}
      {members.isPending && <p>Loading…</p>}
      {members.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <caption className="pb-2 text-left font-medium">
              People in {org.organizationName}
            </caption>
            <thead>
              <tr className="border-b border-slate-300">
                {['Name', 'Access', 'Skills', 'Weekly limit', 'Status'].map((h) => (
                  <th key={h} scope="col" className="p-2">
                    {h}
                  </th>
                ))}
                <th scope="col" className="p-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => {
                const badge = badgeFor(m);
                const deactivated = m.status === 'DEACTIVATED';
                const self = m.id === org.membershipId;
                return (
                  <tr key={m.id} className="border-b border-slate-200 align-top">
                    <th scope="row" className="p-2 font-medium">
                      {m.displayName}
                      {self && <span className="font-normal text-slate-700"> (you)</span>}
                      {m.email && (
                        <span className="block font-normal text-slate-700">{m.email}</span>
                      )}
                    </th>
                    <td className="p-2">{ACCESS_LABEL[m.accessLevel]}</td>
                    <td className="p-2">{skillNames(m.skillIds)}</td>
                    <td className="p-2">{hoursText(m.weeklyLimitMin)}</td>
                    <td className="p-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.tone}`}
                      >
                        <span aria-hidden="true">{badge.symbol}</span>
                        {badge.label}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        {!deactivated && (
                          <Button
                            variant="outline"
                            className={btn}
                            aria-label={`Edit ${m.displayName}`}
                            onClick={() => {
                              remember();
                              setDialog({ member: m });
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        {!deactivated && m.email && !m.hasLogin && (
                          <Button
                            variant="outline"
                            className={btn}
                            disabled={pending}
                            aria-label={`Resend invite to ${m.displayName}`}
                            onClick={() => resend(m)}
                          >
                            Resend invite
                          </Button>
                        )}
                        {!deactivated && !self && (
                          <Button
                            variant="outline"
                            className={btn}
                            aria-label={`Deactivate ${m.displayName}`}
                            onClick={() => {
                              remember();
                              setConfirming(m);
                            }}
                          >
                            Deactivate
                          </Button>
                        )}
                        {deactivated && (
                          <Button
                            variant="outline"
                            className={btn}
                            disabled={pending}
                            aria-label={`Reactivate ${m.displayName}`}
                            onClick={() => reactivate(m)}
                          >
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <MemberDialog
        open={dialog !== null}
        member={dialog?.member ?? null}
        skills={skills.data ?? []}
        onClose={closeDialog}
        onAfterClose={afterClose}
      />
      <Dialog open={confirming !== null}>
        {confirming && (
          <DialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              afterClose();
            }}
            onEscapeKeyDown={() => setConfirming(null)}
            onPointerDownOutside={() => setConfirming(null)}
          >
            <DialogTitle>Deactivate {confirming.displayName}?</DialogTitle>
            <DialogDescription>
              Their open offers are cancelled and their future shifts become open shifts.
            </DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={pending} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => deactivate(confirming)}>
                Yes, deactivate
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
