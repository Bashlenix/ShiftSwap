import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const signInEmail = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth-client', () => ({
  authClient: { signIn: { email: signInEmail } },
}));

function renderLogin(entry: string | { pathname: string; state: unknown } = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/orgs', element: <p>orgs page</p> },
      { path: '/invites/:token', element: <p>invite page</p> },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('LoginPage', () => {
  // Braces matter: a function returned from beforeEach runs as cleanup, and mockReset()
  // returns the mock itself.
  beforeEach(() => {
    signInEmail.mockReset();
  });

  it('shows validation errors linked to the input', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const message = await screen.findByText('Enter a valid email address');
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toContain(message.id);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('shows one generic message on 401', async () => {
    signInEmail.mockResolvedValue({ error: { status: 401 } });
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'anna@shiftswap.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  async function submitValidForm() {
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'anna@shiftswap.test');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  }

  it('asks the user to wait on 429', async () => {
    signInEmail.mockResolvedValue({ error: { status: 429 } });
    await submitValidForm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait a few seconds and try again.',
    );
  });

  it('shows the generic message when the request throws', async () => {
    signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    await submitValidForm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
  });

  it('navigates to /orgs on success', async () => {
    signInEmail.mockResolvedValue({ data: {} });
    const router = renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'Anna@ShiftSwap.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
    expect(signInEmail).toHaveBeenCalledWith({
      email: 'anna@shiftswap.test',
      password: 'secret',
    });
  });

  it('shows the notice passed in navigation state', () => {
    renderLogin({ pathname: '/login', state: { notice: 'Your account was deleted.' } });
    expect(screen.getByRole('status')).toHaveTextContent('Your account was deleted.');
  });

  it('has a link to create an account', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    );
  });

  it('carries next into the sign-up link', () => {
    renderLogin('/login?next=/invites/tok');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup?next=%2Finvites%2Ftok',
    );
  });

  async function loginWith(entry: string) {
    signInEmail.mockResolvedValue({ data: {} });
    const router = renderLogin(entry);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.test');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    return router;
  }

  it('honours a same-origin next path', async () => {
    const router = await loginWith('/login?next=/invites/tok');
    await waitFor(() => expect(router.state.location.pathname).toBe('/invites/tok'));
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    'ignores open-redirect next %s',
    async (next) => {
      const router = await loginWith(`/login?next=${encodeURIComponent(next)}`);
      await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
    },
  );
});
