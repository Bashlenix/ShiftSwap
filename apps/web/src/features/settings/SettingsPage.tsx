import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrgDto, OrgSettingsInput } from '@shiftswap/shared';
import { useState, type FormEvent } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { orgApi, useOrg } from '../org/useOrg';
import { SkillsSection } from './SkillsSection';

type HourField = 'defaultWeeklyLimitMin' | 'minRestMin' | 'maxDailyMin' | 'offerLeadTimeMin';

const HOUR_FIELDS: { key: HourField; label: string }[] = [
  { key: 'defaultWeeklyLimitMin', label: 'Weekly hour limit (h)' },
  { key: 'minRestMin', label: 'Minimum rest between shifts (h)' },
  { key: 'maxDailyMin', label: 'Maximum hours per day (h)' },
  { key: 'offerLeadTimeMin', label: 'Offer closes before shift start (h)' },
];

const toHours = (min: number) => String(Math.round(min / 6) / 10);

export function SettingsPage() {
  const org = useOrg();
  if (org.accessLevel !== 'ADMIN') return <p>Only admins can see this page.</p>;
  return <Settings />;
}

function Settings() {
  const org = useOrg();
  const orgQuery = useQuery({
    queryKey: ['org', org.organizationId],
    queryFn: () => apiFetch<OrgDto>(orgApi(org, '')),
  });
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {orgQuery.isError && <p role="alert">Could not load the settings. Please try again.</p>}
      {orgQuery.isPending && <p>Loading…</p>}
      {orgQuery.data && <SettingsForm current={orgQuery.data} />}
      <SkillsSection />
    </div>
  );
}

function SettingsForm({ current }: { current: OrgDto }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState(current.name);
  const [timezone, setTimezone] = useState(current.timezone);
  const [hours, setHours] = useState<Record<HourField, string>>({
    defaultWeeklyLimitMin: toHours(current.defaultWeeklyLimitMin),
    minRestMin: toHours(current.minRestMin),
    maxDailyMin: toHours(current.maxDailyMin),
    offerLeadTimeMin: toHours(current.offerLeadTimeMin),
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const zones = Intl.supportedValuesOf('timeZone');
  if (!zones.includes(current.timezone)) zones.push(current.timezone);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const changes: OrgSettingsInput = {};
    if (name.trim() !== current.name) changes.name = name.trim();
    if (timezone !== current.timezone) changes.timezone = timezone;
    for (const { key } of HOUR_FIELDS) {
      const raw = hours[key].trim();
      const value = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(value)) {
        setError('Enter a number of hours.');
        return;
      }
      const minutes = Math.round(value * 60);
      if (minutes !== current[key]) changes[key] = minutes;
    }
    if (Object.keys(changes).length === 0) {
      setNotice('No changes to save.');
      return;
    }
    setPending(true);
    try {
      await apiSend<OrgDto>('PATCH', orgApi(org, ''), changes);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['org', org.organizationId] }),
      ]);
      setNotice('Settings saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const field = 'flex max-w-md flex-col gap-1';
  return (
    <form onSubmit={save} className="flex flex-col gap-4" aria-labelledby="org-settings-heading">
      <h2 id="org-settings-heading" className="text-xl font-semibold">
        Organisation
      </h2>
      <div className={field}>
        <label htmlFor="org-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="org-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className={field}>
        <label htmlFor="org-timezone" className="text-sm font-medium">
          Time zone
        </label>
        <select
          id="org-timezone"
          className="h-10 rounded-md border border-slate-400 bg-white px-2 text-sm"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
      {HOUR_FIELDS.map(({ key, label }) => (
        <div key={key} className={field}>
          <label htmlFor={`org-${key}`} className="text-sm font-medium">
            {label}
          </label>
          <Input
            id={`org-${key}`}
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={hours[key]}
            onChange={(e) => setHours({ ...hours, [key]: e.target.value })}
          />
        </div>
      ))}
      <p className="text-sm text-slate-700">
        These are company policy checks, not a legal compliance guarantee.
      </p>
      <Feedback error={error} notice={notice} />
      <Button type="submit" className="self-start" disabled={pending}>
        Save settings
      </Button>
    </form>
  );
}
