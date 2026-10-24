import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { authClient } from '../../lib/auth-client';
import { PASSWORD_ERROR, PASSWORD_HINT } from '../../lib/password-copy';
import { safeNext, withNext } from '../../lib/safe-next';
import { isAlreadyRegistered } from '../../lib/sign-up-error';

const GENERIC_FAILURE = 'Something went wrong. Please try again.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'name' | 'email' | 'password';

export function SignUpPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext);
  const loginHref = withNext('/login', rawNext ? next : null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Synchronous re-entry guard: two submits in one render would both still see busy=false.
  const inFlight = useRef(false);
  const [exists, setExists] = useState(false);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') ?? '');
    const found: Partial<Record<Field, string>> = {};
    if (!name) found.name = 'Enter your name';
    if (!EMAIL_RE.test(email)) found.email = 'Enter a valid email address';
    if (password.length < 8) found.password = PASSWORD_ERROR;
    setErrors(found);
    setFormError(null);
    setExists(false);
    const first = (['name', 'email', 'password'] as const).find((f) => found[f]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const { error } = await authClient.signUp.email({ email, password, name });
      if (error) {
        const already = isAlreadyRegistered(error);
        setExists(already);
        setFormError(
          already ? 'You already have an account. Log in to continue.' : GENERIC_FAILURE,
        );
        return;
      }
      await navigate(next);
    } catch {
      setFormError(GENERIC_FAILURE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const fieldProps = (f: Field) => ({
    id: f,
    name: f,
    ref: refs[f],
    'aria-invalid': errors[f] ? ('true' as const) : undefined,
    'aria-describedby':
      [errors[f] ? `${f}-error` : '', f === 'password' ? 'password-hint' : '']
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const fieldError = (f: Field) => (
    <div aria-live="polite">
      {errors[f] && (
        <p id={`${f}-error`} className="text-sm text-red-700">
          {errors[f]}
        </p>
      )}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input {...fieldProps('name')} type="text" autoComplete="name" />
              {fieldError('name')}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input {...fieldProps('email')} type="email" autoComplete="username" />
              {fieldError('email')}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input {...fieldProps('password')} type="password" autoComplete="new-password" />
              <p id="password-hint" className="text-sm text-slate-700">
                {PASSWORD_HINT}
              </p>
              {fieldError('password')}
            </div>
            <Feedback error={formError} />
            {exists && (
              <p>
                <Link className="font-medium text-indigo-800 underline" to={loginHref}>
                  Log in
                </Link>
              </p>
            )}
            <Button type="submit" disabled={busy}>
              Create account
            </Button>
          </form>
          <p className="mt-4 text-sm">
            Already have an account?{' '}
            <Link className="font-medium text-indigo-800 underline" to={loginHref}>
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
