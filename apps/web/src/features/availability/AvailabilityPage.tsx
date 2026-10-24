import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageHeader } from '../../components/ui/page-header';
import { Table, TD, TH, THead, TR } from '../../components/ui/table';
import { apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { formatShiftTime, localToInstant } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { PreferenceGrid } from './PreferenceGrid';

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
  const [notice, setNotice] = useState<string | null>(null);
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
    mutationFn: (v: { method: 'POST' | 'DELETE'; path: string; body?: unknown; notice: string }) =>
      v.body === undefined
        ? apiSend(v.method, orgApi(org, v.path))
        : apiSend(v.method, orgApi(org, v.path), v.body),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (_d, v) => setNotice(v.notice),
    onError: (err) => setError(errorMessage(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  function onSubmit(values: FormValues) {
    write.mutate(
      {
        method: 'POST',
        path: '/me/unavailability',
        notice: 'Unavailable time added.',
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
      <PageHeader
        id="availability-heading"
        title="Availability"
        description="Unavailable times are hard blocks: you won't be offered shifts that overlap them."
      />
      <Card className="flex flex-col gap-3 p-4 sm:p-6">
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
                <p id="from-error" className="text-sm text-danger">
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
                <p id="until-error" className="text-sm text-danger">
                  {errors.endAt.message}
                </p>
              )}
            </div>
          </div>
          <Button type="submit" className="mt-5" disabled={write.isPending}>
            Add
          </Button>
        </form>
        <p className="text-xs text-muted">
          Times are in the organisation&apos;s time zone ({org.timezone}).
        </p>
      </Card>
      <Feedback error={error} notice={notice} />
      {list.isPending && <p>Loading…</p>}
      {list.isError && <p role="alert">Could not load your unavailable times. Please try again.</p>}
      {list.data?.length === 0 && (
        <EmptyState icon={CalendarOff} title="You have not marked any unavailable times." />
      )}
      {list.data && list.data.length > 0 && (
        <Table>
          <caption className="sr-only">Your unavailable times</caption>
          <THead>
            <TR>
              <TH>Unavailable</TH>
              <TH>Action</TH>
            </TR>
          </THead>
          <tbody>
            {list.data.map((u) => {
              const label = formatShiftTime(u.startAt, u.endAt, org.timezone);
              return (
                <TR key={u.id}>
                  <TH scope="row">{label}</TH>
                  <TD>
                    <Button
                      variant="outline"
                      aria-label={`Delete ${label}`}
                      disabled={write.isPending}
                      onClick={() =>
                        write.mutate({
                          method: 'DELETE',
                          path: `/me/unavailability/${u.id}`,
                          notice: 'Unavailable time removed.',
                        })
                      }
                    >
                      Delete
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
      <PreferenceGrid />
    </section>
  );
}
