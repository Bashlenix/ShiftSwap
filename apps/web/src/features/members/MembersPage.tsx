import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, UserPlus } from 'lucide-react';
import type { DeactivationResult, MemberDto, SkillDto } from '@shiftswap/shared';
import { useRef, useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Table, TableCaption, TD, TH, THead, TR } from '../../components/ui/table';
import { apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { cn } from '../../lib/utils';
import { orgApi, useOrg } from '../org/useOrg';
import { useSkillNames } from '../org/useSkillNames';
import { InviteDialog } from './InviteDialog';
import { InviteResult } from './InviteResult';
import { MemberDialog, type MemberDialogResult } from './MemberDialog';
import {
  ACCESS_LABEL,
  filterMembers,
  memberStatus,
  type MemberStatus,
  sortMembers,
  type MemberSortKey,
  type SortDir,
} from './member-table';

const COLUMNS: { key: MemberSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'access', label: 'Access' },
  { key: 'skills', label: 'Skills' },
  { key: 'weeklyLimit', label: 'Weekly limit' },
  { key: 'status', label: 'Status' },
];

type StatusLook = { label: string; symbol: string; tone: BadgeTone };

const BADGES: Record<MemberStatus, StatusLook> = {
  Deactivated: { label: 'Deactivated', symbol: '–', tone: 'neutral' },
  'Invite pending': { label: 'Invite pending', symbol: '…', tone: 'warning' },
  'No login': { label: 'No login', symbol: '○', tone: 'neutral' },
  Active: { label: 'Active', symbol: '✓', tone: 'success' },
};

const badgeFor = (m: MemberDto): StatusLook => BADGES[memberStatus(m)];

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
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: MemberSortKey; dir: SortDir }>({
    key: 'name',
    dir: 'asc',
  });
  const [dialog, setDialog] = useState<{ member: MemberDto | null } | null>(null);
  const [confirming, setConfirming] = useState<MemberDto | null>(null);
  const [inviting, setInviting] = useState<MemberDto | null>(null);
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

  const skillLabel = (id: string) => skillNames([id]);
  // At most 100 members, so no memoisation.
  const rows = members.data
    ? sortMembers(filterMembers(members.data, query, skillLabel), sort.key, sort.dir, skillLabel)
    : [];

  function toggleSort(key: MemberSortKey) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  }

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
    setInviting(null);
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
      setError(errorMessage(err, { context: 'member' }));
    } finally {
      setPending(false);
      afterDone?.();
    }
  }

  function resend(m: MemberDto) {
    remember();
    setInvite(null);
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
      <PageHeader
        id="members-heading"
        title="Members"
        actions={
          <>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Show deactivated
            </label>
            <Button
              onClick={() => {
                remember();
                setInvite(null);
                setDialog({ member: null });
              }}
            >
              <UserPlus aria-hidden="true" />
              Add person
            </Button>
          </>
        }
      />
      <Feedback error={error} notice={notice} containerRef={feedbackRef} />
      {invite && <InviteResult email={invite.email} link={invite.link} containerRef={inviteRef} />}
      {members.isError && <p role="alert">Could not load the members. Please try again.</p>}
      {members.isPending && <p>Loading…</p>}
      {members.data && (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <label className="flex w-full max-w-sm flex-col gap-1.5 text-sm font-medium">
            Search members
            <span className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 font-normal"
              />
            </span>
          </label>
          <p role="status" className="text-sm text-muted">
            Showing {rows.length} of {members.data.length} members
          </p>
        </div>
      )}
      {members.data && (
        <Table className="min-w-[44rem]">
          <TableCaption>People in {org.organizationName}</TableCaption>
          <THead>
            <TR>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <TH
                    key={c.key}
                    className="py-1.5"
                    aria-sort={!active ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending'}
                  >
                    <button
                      type="button"
                      className="-mx-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 font-semibold hover:bg-slate-200/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      <SortIcon
                        aria-hidden="true"
                        className={cn('size-3.5', active ? 'text-brand' : 'text-muted')}
                      />
                    </button>
                  </TH>
                );
              })}
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <tbody>
            {rows.length === 0 && (
              <TR>
                <TD colSpan={6}>
                  {members.data.length === 0
                    ? 'No members yet.'
                    : `No members match "${query.trim()}".`}
                </TD>
              </TR>
            )}
            {rows.map((m) => {
              const badge = badgeFor(m);
              const deactivated = m.status === 'DEACTIVATED';
              const self = m.id === org.membershipId;
              return (
                <TR key={m.id} className="align-top">
                  <TH scope="row">
                    {m.displayName}
                    {self && <span className="font-normal text-muted"> (you)</span>}
                    {m.email && <span className="block font-normal text-muted">{m.email}</span>}
                  </TH>
                  <TD>{ACCESS_LABEL[m.accessLevel]}</TD>
                  <TD>{skillNames(m.skillIds)}</TD>
                  <TD>{hoursText(m.weeklyLimitMin)}</TD>
                  <TD>
                    <Badge tone={badge.tone}>
                      <span aria-hidden="true">{badge.symbol}</span>
                      {badge.label}
                    </Badge>
                  </TD>
                  <TD>
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
                      {!deactivated && !m.email && !m.hasLogin && (
                        <Button
                          variant="outline"
                          className={btn}
                          aria-label={`Invite ${m.displayName}`}
                          onClick={() => {
                            remember();
                            setInvite(null);
                            setInviting(m);
                          }}
                        >
                          Invite
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
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
      <MemberDialog
        open={dialog !== null}
        member={dialog?.member ?? null}
        skills={skills.data ?? []}
        onClose={closeDialog}
        onAfterClose={afterClose}
      />
      <InviteDialog
        member={inviting && (members.data?.find((x) => x.id === inviting.id) ?? inviting)}
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
            onEscapeKeyDown={() => !pending && setConfirming(null)}
            onPointerDownOutside={() => !pending && setConfirming(null)}
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
