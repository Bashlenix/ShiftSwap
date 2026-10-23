import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { formatShiftTime, localToInstant } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';

interface UnavailabilityDto {
  id: string;
  startAt: string;
  endAt: string;
}

const formSchema = z
  .object({
    startAt: z.string().min(1, 'Choose a start'),
    endAt: z.string().min(1, 'Choose an end'),
  })
  .superRefine((v, ctx) => {
    if (v.startAt && v.endAt && v.endAt <= v.startAt) {
      ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'End must be after start' });
    }
  });
type FormValues = z.infer<typeof formSchema>;

export function AvailabilityPage() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const key = ['unavailability', org.organizationId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<UnavailabilityDto[]>(orgApi(org, '/me/unavailability')),
  });
  const write = useMutation({
    mutationFn: (v: { method: 'POST' | 'DELETE'; path: string; body?: unknown }) =>
      v.body === undefined
        ? apiSend(v.method, orgApi(org, v.path))
        : apiSend(v.method, orgApi(org, v.path), v.body),
    onMutate: () => setError(null),
    onError: (err) => setError(errorMessage(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  function onSubmit(values: FormValues) {
    write.mutate(
      {
        method: 'POST',
        path: '/me/unavailability',
        body: {
          startAt: localToInstant(values.startAt, org.timezone),
          endAt: localToInstant(values.endAt, org.timezone),
        },
      },
      { onSuccess: () => reset() },
    );
  }

  return (
    <section aria-labelledby="availability-heading" className="flex flex-col gap-4">
      <h1 id="availability-heading" className="text-2xl font-semibold">
        Availability
      </h1>
      <p className="text-sm text-slate-700">
        Unavailable times are hard blocks: you won&apos;t be offered shifts that overlap them.
      </p>
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-wrap items-start gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="datetime-local"
            aria-invalid={errors.startAt ? 'true' : undefined}
            aria-describedby={errors.startAt ? 'from-error' : undefined}
            {...register('startAt')}
          />
          <div aria-live="polite">
            {errors.startAt && (
              <p id="from-error" className="text-sm text-red-700">
                {errors.startAt.message}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="until">Until</Label>
          <Input
            id="until"
            type="datetime-local"
            aria-invalid={errors.endAt ? 'true' : undefined}
            aria-describedby={errors.endAt ? 'until-error' : undefined}
            {...register('endAt')}
          />
          <div aria-live="polite">
            {errors.endAt && (
              <p id="until-error" className="text-sm text-red-700">
                {errors.endAt.message}
              </p>
            )}
          </div>
        </div>
        <Button type="submit" className="mt-6" disabled={write.isPending}>
          Add
        </Button>
      </form>
      <p className="text-xs text-slate-600">
        Times are in the organisation&apos;s time zone ({org.timezone}).
      </p>
      <Feedback error={error} />
      {list.isPending && <p>Loading…</p>}
      {list.isError && <p role="alert">Could not load your unavailable times. Please try again.</p>}
      {list.data?.length === 0 && <p>You have not marked any unavailable times.</p>}
      {list.data && list.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Your unavailable times</caption>
          <thead>
            <tr className="border-b border-slate-300">
              <th scope="col" className="p-2">
                Unavailable
              </th>
              <th scope="col" className="p-2">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((u) => {
              const label = formatShiftTime(u.startAt, u.endAt, org.timezone);
              return (
                <tr key={u.id} className="border-b border-slate-200">
                  <th scope="row" className="p-2 font-medium">
                    {label}
                  </th>
                  <td className="p-2">
                    <Button
                      variant="outline"
                      aria-label={`Delete ${label}`}
                      disabled={write.isPending}
                      onClick={() =>
                        write.mutate({ method: 'DELETE', path: `/me/unavailability/${u.id}` })
                      }
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
