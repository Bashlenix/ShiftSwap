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

const HOUR_FIELDS: { key: HourField; label: string; name: string; min: number; max: number }[] = [
  {
    key: 'defaultWeeklyLimitMin',
    label: 'Weekly hour limit (h)',
    name: 'Weekly hour limit',
    min: 1,
    max: 80,
  },
  {
    key: 'minRestMin',
    label: 'Minimum rest between shifts (h)',
    name: 'Minimum rest between shifts',
    min: 0,
    max: 24,
  },
  {
    key: 'maxDailyMin',
    label: 'Maximum hours per day (h)',
    name: 'Maximum hours per day',
    min: 1,
    max: 24,
  },
  {
    key: 'offerLeadTimeMin',
    label: 'Offer closes before shift start (h)',
    name: 'Offer closes before shift start',
    min: 0,
    max: 48,
  },
];

const ZONES: string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

const hoursOf = (o: OrgDto): Record<HourField, string> => ({
  defaultWeeklyLimitMin: toHours(o.defaultWeeklyLimitMin),
  minRestMin: toHours(o.minRestMin),
  maxDailyMin: toHours(o.maxDailyMin),
  offerLeadTimeMin: toHours(o.offerLeadTimeMin),
});

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
      {orgQuery.data && <SettingsForm initial={orgQuery.data} />}
      <SkillsSection />
    </div>
  );
}

function SettingsForm({ initial }: { initial: OrgDto }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  // What the server holds now; updated from each save response so later edits diff against it.
  // Hour strings are lossy (1235 min shows as 20.6 h), so untouched fields are never re-sent.
  const [saved, setSaved] = useState(initial);
  const initialHours = hoursOf(saved);
  const [name, setName] = useState(initial.name);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [hours, setHours] = useState<Record<HourField, string>>(initialHours);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<HourField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const zones = ZONES.includes(saved.timezone) ? ZONES : [...ZONES, saved.timezone];

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const changes: OrgSettingsInput = {};
    if (name.trim() !== saved.name) changes.name = name.trim();
    if (timezone !== saved.timezone) changes.timezone = timezone;
    const errors: Partial<Record<HourField, string>> = {};
    for (const { key, name, min, max } of HOUR_FIELDS) {
      const raw = hours[key].trim();
      if (raw === initialHours[key]) continue;
      const value = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(value)) errors[key] = 'Enter a number of hours.';
      else if (value < min || value > max)
        errors[key] = `${name} must be between ${min} and ${max} hours.`;
      else changes[key] = Math.round(value * 60);
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (Object.keys(changes).length === 0) {
      setNotice('No changes to save.');
      return;
    }
    setPending(true);
    try {
      const dto = await apiSend<OrgDto>('PATCH', orgApi(org, ''), changes);
      setSaved(dto);
      setHours(hoursOf(dto));
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
            step="any"
            aria-invalid={fieldErrors[key] ? true : undefined}
            aria-describedby={fieldErrors[key] ? `org-${key}-error` : undefined}
            value={hours[key]}
            onChange={(e) => {
              setHours({ ...hours, [key]: e.target.value });
              setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
            }}
          />
          {fieldErrors[key] && (
            <p id={`org-${key}-error`} role="alert" className="text-sm text-red-700">
              {fieldErrors[key]}
            </p>
          )}
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
