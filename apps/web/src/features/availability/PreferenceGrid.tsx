import {
  PREFERENCE_SLOTS,
  type PreferenceEntry,
  type PreferenceGridDto,
  type PreferenceSlot,
  type PreferenceValue,
} from '@shiftswap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { orgApi, useOrg } from '../org/useOrg';

type Choice = PreferenceValue | 'NEUTRAL';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOT_HEADERS: Record<PreferenceSlot, string> = {
  MORNING: 'Morning (05–12)',
  AFTERNOON: 'Afternoon (12–17)',
  EVENING: 'Evening (17–05)',
};
const CHOICES: { value: Choice; label: string }[] = [
  { value: 'PREFERRED', label: 'Preferred' },
  { value: 'NEUTRAL', label: 'Neutral' },
  { value: 'AVOID', label: 'Avoid' },
];

const cellKey = (weekday: number, slot: PreferenceSlot) => `${weekday}:${slot}`;

function toMap(entries: PreferenceEntry[]): Record<string, Choice> {
  const map: Record<string, Choice> = {};
  for (const e of entries) map[cellKey(e.weekday, e.slot)] = e.value;
  return map;
}

export function PreferenceGrid() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const key = ['preferences', org.organizationId];
  const [overrides, setOverrides] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saving = useRef(false);

  const query = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<PreferenceGridDto>(orgApi(org, '/me/preferences')),
  });
  const baseline = toMap(query.data?.entries ?? []);
  const current = (weekday: number, slot: PreferenceSlot): Choice => {
    const k = cellKey(weekday, slot);
    return overrides[k] ?? baseline[k] ?? 'NEUTRAL';
  };

  const save = useMutation({
    mutationFn: (entries: PreferenceEntry[]) =>
      apiSend<PreferenceGridDto>('PUT', orgApi(org, '/me/preferences'), { entries }),
    onSuccess: (dto, sent) => {
      queryClient.setQueryData(key, dto);
      // Clear only the choices that were sent; later edits made during the PUT stay.
      const sentMap = toMap(sent);
      setOverrides((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([k, v]) => v !== (sentMap[k] ?? 'NEUTRAL')),
        ),
      );
      setNotice('Preferences saved.');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(errorMessage(err)),
    onSettled: () => {
      saving.current = false;
    },
  });

  const dirty = Object.entries(overrides).some(([k, v]) => v !== (baseline[k] ?? 'NEUTRAL'));

  function choose(weekday: number, slot: PreferenceSlot, value: Choice) {
    setNotice(null);
    setOverrides((prev) => ({ ...prev, [cellKey(weekday, slot)]: value }));
  }

  function onSave() {
    if (saving.current || !dirty) return;
    saving.current = true;
    setError(null);
    setNotice(null);
    const entries: PreferenceEntry[] = [];
    DAYS.forEach((_, weekday) => {
      for (const slot of PREFERENCE_SLOTS) {
        const value = current(weekday, slot);
        if (value !== 'NEUTRAL') entries.push({ weekday, slot, value });
      }
    });
    save.mutate(entries);
  }

  return (
    <section aria-labelledby="preferences-heading" className="flex flex-col gap-3">
      <h2 id="preferences-heading" className="text-lg font-semibold tracking-tight">
        Weekly preferences
      </h2>
      <p className="text-sm text-muted">
        Preferences only affect ranking. To block a time, add unavailability above.
      </p>
      {query.isPending && <p>Loading…</p>}
      {query.isError && <p role="alert">Could not load your preferences. Please try again.</p>}
      {query.data && (
        <div className="sm:rounded-card sm:border sm:border-slate-200 sm:bg-surface sm:px-4 sm:py-2 sm:shadow-soft">
          <table className="w-full table-fixed border-collapse text-left text-xs tracking-tight">
            <caption className="sr-only">Weekly shift preferences</caption>
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50">
                <td className="w-[70px] p-0" />
                {PREFERENCE_SLOTS.map((slot) => (
                  <th key={slot} scope="col" className="px-0.5 py-1.5 leading-tight font-semibold">
                    {SLOT_HEADERS[slot]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, weekday) => (
                <tr key={day} className="border-b border-slate-200 align-top">
                  <th scope="row" className="pt-3.5 pr-0.5 font-medium text-slate-900">
                    {day}
                  </th>
                  {PREFERENCE_SLOTS.map((slot) => (
                    <td key={slot} className="p-0">
                      <fieldset className="m-0 flex flex-col border-0 p-0">
                        <legend className="sr-only">{`${day} ${slot.toLowerCase()}`}</legend>
                        {CHOICES.map((c) => (
                          <label
                            key={c.value}
                            className="flex min-h-11 cursor-pointer items-center gap-0.5 rounded-md hover:bg-indigo-50 has-[:checked]:text-brand-strong"
                          >
                            <input
                              type="radio"
                              name={`pref-${weekday}-${slot}`}
                              className="m-0 size-4 shrink-0"
                              checked={current(weekday, slot) === c.value}
                              onChange={() => choose(weekday, slot, c.value)}
                            />
                            {c.label}
                          </label>
                        ))}
                      </fieldset>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <Button type="button" onClick={onSave} disabled={!dirty || save.isPending}>
          Save preferences
        </Button>
      </div>
      <Feedback error={error} />
      <div role="status" className="min-h-6 text-sm text-success">
        {notice}
      </div>
    </section>
  );
}
