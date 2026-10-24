import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignUpPage } from './SignUpPage';

const signUpEmail = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth-client', () => ({ authClient: { signUp: { email: signUpEmail } } }));

function renderPage(entry = '/signup') {
  const router = createMemoryRouter(
    [
      { path: '/signup', element: <SignUpPage /> },
      { path: '/orgs', element: <p>orgs page</p> },
      { path: '/orgs/:id', element: <p>org detail</p> },
      { path: '/login', element: <p>login page</p> },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function fill(password = 'longenough1') {
  await userEvent.type(screen.getByLabelText('Name'), 'Anna Schmidt');
  await userEvent.type(screen.getByLabelText('Email'), 'Anna@ShiftSwap.test');
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignUpPage', () => {
  beforeEach(() => {
    signUpEmail.mockReset();
  });

  it('has a heading and a link to log in', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeVisible();
  });

  it('posts the sign-up and redirects to /orgs', async () => {
    signUpEmail.mockResolvedValue({ data: {} });
    const router = renderPage();
    await fill();
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
    expect(signUpEmail).toHaveBeenCalledWith({
      email: 'anna@shiftswap.test',
      password: 'longenough1',
      name: 'Anna Schmidt',
    });
  });

  it('a double submit sends one sign-up request', async () => {
    let finish: (v: unknown) => void = () => {};
    signUpEmail.mockReturnValue(new Promise((r) => (finish = r)));
    const router = renderPage();
    await userEvent.type(screen.getByLabelText('Name'), 'Anna Schmidt');
    await userEvent.type(screen.getByLabelText('Email'), 'anna@shiftswap.test');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    const form = screen.getByRole('button', { name: 'Create account' }).closest('form')!;
    // Two submits in one batch: React has not re-rendered the disabled button in between.
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(signUpEmail).toHaveBeenCalledTimes(1);
    finish({ data: {} });
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
  });

  it('honours a same-origin next path', async () => {
    signUpEmail.mockResolvedValue({ data: {} });
    const router = renderPage('/signup?next=/orgs/o1');
    await fill();
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/o1'));
  });

  it('ignores an open-redirect next', async () => {
    signUpEmail.mockResolvedValue({ data: {} });
    const router = renderPage('/signup?next=//evil.example');
    await fill();
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
  });

  it('rejects a short password without calling the API and focuses it', async () => {
    renderPage();
    await fill('short');
    const field = screen.getByLabelText('Password');
    expect(await screen.findByText('Use at least 8 characters')).toBeVisible();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('shows the already-have-an-account hint with a login link carrying next', async () => {
    signUpEmail.mockResolvedValue({ error: { status: 422, code: 'USER_ALREADY_EXISTS' } });
    renderPage('/signup?next=/orgs/o1');
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have an account.');
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute(
      'href',
      '/login?next=%2Forgs%2Fo1',
    );
  });

  it('shows a generic message when the request throws', async () => {
    signUpEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
  });

  it('a 422 with another code is a generic error without the log-in hint', async () => {
    signUpEmail.mockResolvedValue({ error: { status: 422, code: 'INVALID_PASSWORD' } });
    renderPage();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
    expect(screen.getAllByRole('link', { name: 'Log in' })).toHaveLength(1);
  });
});
