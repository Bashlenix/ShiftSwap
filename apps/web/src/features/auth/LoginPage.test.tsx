import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const signInEmail = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth-client', () => ({
  authClient: { signIn: { email: signInEmail } },
}));

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/orgs', element: <p>orgs page</p> },
    ],
    { initialEntries: ['/login'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('LoginPage', () => {
  beforeEach(() => signInEmail.mockReset());

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
});
