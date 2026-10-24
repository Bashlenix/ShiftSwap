import { createOrgSchema, isValidTimeZone, type OrgDto } from '@shiftswap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { AuthLayout } from '../../components/AuthLayout';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';

const ZONES: string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

function defaultZone(): string {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browser && isValidTimeZone(browser) ? browser : 'Europe/Berlin';
}

export function CreateOrgPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [zone] = useState(defaultZone);
  const [errors, setErrors] = useState<{ name?: string; timezone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = createOrgSchema.safeParse({
      name: String(form.get('name') ?? ''),
      timezone: String(form.get('timezone') ?? ''),
    });
    setFormError(null);
    if (!parsed.success) {
      const found: { name?: string; timezone?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'name' || key === 'timezone') && !found[key]) found[key] = issue.message;
      }
      setErrors(found);
      (found.name ? nameRef : zoneRef).current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const org = await apiSend<OrgDto>('POST', '/api/v1/orgs', parsed.data);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await navigate(`/orgs/${org.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Create organisation</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                ref={nameRef}
                autoComplete="organization"
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              <div aria-live="polite">
                {errors.name && (
                  <p id="name-error" className="text-sm text-danger">
                    {errors.name}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timezone">Time zone</Label>
              <Input
                id="timezone"
                name="timezone"
                ref={zoneRef}
                list="timezone-options"
                defaultValue={zone}
                autoComplete="off"
                aria-invalid={errors.timezone ? 'true' : undefined}
                aria-describedby={errors.timezone ? 'timezone-error' : undefined}
              />
              <datalist id="timezone-options">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <div aria-live="polite">
                {errors.timezone && (
                  <p id="timezone-error" className="text-sm text-danger">
                    {errors.timezone}
                  </p>
                )}
              </div>
            </div>
            <Feedback error={formError} />
            <Button type="submit" disabled={busy}>
              Create organisation
            </Button>
          </form>
          <p className="mt-4 text-sm">
            <Link className="font-medium text-brand-strong underline" to="/orgs">
              Back to your organisations
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
