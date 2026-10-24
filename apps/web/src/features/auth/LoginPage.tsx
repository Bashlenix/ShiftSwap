import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@shiftswap/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../../components/AuthLayout';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { authClient } from '../../lib/auth-client';
import { refreshSession } from '../../lib/session';
import { safeNext, withNext } from '../../lib/safe-next';

const WRONG_CREDENTIALS = 'Email or password is incorrect.';
const GENERIC_FAILURE = 'Something went wrong. Please try again.';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a few seconds and try again.';

function messageFor(status: number): string {
  if (status === 401) return WRONG_CREDENTIALS;
  if (status === 429) return TOO_MANY_ATTEMPTS;
  return GENERIC_FAILURE;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const state = useLocation().state as { notice?: unknown } | null;
  const notice = typeof state?.notice === 'string' ? state.notice : null;
  const rawNext = params.get('next');
  const next = safeNext(rawNext);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      const { error } = await authClient.signIn.email(values);
      if (error) {
        setFormError(messageFor(error.status));
        return;
      }
      await refreshSession();
      await navigate(next);
    } catch {
      setFormError(GENERIC_FAILURE);
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Log in to ShiftSwap</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status">{notice && <p className="mb-4 text-sm">{notice}</p>}</div>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              <div aria-live="polite">
                {errors.email && (
                  <p id="email-error" className="text-sm text-danger">
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? 'true' : undefined}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              <div aria-live="polite">
                {errors.password && (
                  <p id="password-error" className="text-sm text-danger">
                    {errors.password.message}
                  </p>
                )}
              </div>
            </div>
            <div aria-live="polite">
              {formError && (
                <p role="alert" className="text-sm text-danger">
                  {formError}
                </p>
              )}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              Log in
            </Button>
          </form>
          <p className="mt-4 text-sm">
            <Link
              className="font-medium text-brand-strong underline"
              to={withNext('/signup', rawNext ? next : null)}
            >
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
