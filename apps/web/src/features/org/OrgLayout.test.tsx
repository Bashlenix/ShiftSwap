import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgLayout } from './OrgLayout';
import { useOrg } from './useOrg';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

const me = {
  user: { id: 'u1', email: 'a@b.test', name: 'Anna' },
  memberships: [
    {
      membershipId: 'm1',
      organizationId: 'o1',
      organizationName: 'Café Lindenhof',
      accessLevel: 'EMPLOYEE',
      organizationTimezone: 'Europe/Berlin',
    },
  ],
};

function Probe() {
  const org = useOrg();
  return <p>tz {org.timezone}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/orgs/:orgId',
        element: <OrgLayout />,
        children: [
          { path: 'me/shifts', element: <Probe /> },
          { path: 'offers', element: <p>offers page</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return Object.assign(router, { unmount: view.unmount });
}

describe('OrgLayout', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('shows Organisation not found for an org the user is not a member of', async () => {
    apiFetch.mockResolvedValue(me);
    renderAt('/orgs/other/me/shifts');
    expect(await screen.findByText('Organisation not found')).toBeVisible();
    expect(screen.queryByText(/tz /)).toBeNull();
  });

  it('renders nav, org name and provides org info to children', async () => {
    apiFetch.mockResolvedValue(me);
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByText('tz Europe/Berlin')).toBeVisible();
    expect(screen.getByText('Café Lindenhof')).toBeVisible();
    expect(screen.getByRole('link', { name: 'My shifts' })).toHaveAttribute(
      'href',
      '/orgs/o1/me/shifts',
    );
    expect(screen.getByRole('link', { name: 'Open offers' })).toHaveAttribute(
      'href',
      '/orgs/o1/offers',
    );
    expect(screen.getByRole('link', { name: 'Availability' })).toHaveAttribute(
      'href',
      '/orgs/o1/me/availability',
    );
    expect(screen.getByRole('link', { name: 'Switch organisation' })).toHaveAttribute(
      'href',
      '/orgs',
    );
    expect(screen.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  it('shows the unread count in the Notifications link', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/unread-count') ? { count: 3 } : me),
    );
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByRole('link', { name: 'Notifications (3)' })).toHaveAttribute(
      'href',
      '/orgs/o1/notifications',
    );
  });

  it('shows plain Notifications when nothing is unread', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/unread-count') ? { count: 0 } : me),
    );
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeVisible();
  });

  it('shows Audit to managers and Settings only to admins', async () => {
    const as = (accessLevel: string) =>
      apiFetch.mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith('/unread-count')
            ? { count: 0 }
            : { ...me, memberships: [{ ...me.memberships[0], accessLevel }] },
        ),
      );
    as('MANAGER');
    const { unmount } = renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByRole('link', { name: 'Audit' })).toHaveAttribute(
      'href',
      '/orgs/o1/audit',
    );
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    unmount();
    as('ADMIN');
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/orgs/o1/settings',
    );
  });

  it('hides the manager links from employees and shows them to managers', async () => {
    apiFetch.mockResolvedValue(me);
    renderAt('/orgs/o1/me/shifts');
    await screen.findByText('tz Europe/Berlin');
    expect(screen.queryByRole('link', { name: 'Schedule' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Offer review' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('shows Schedule and Offer review to managers', async () => {
    apiFetch.mockResolvedValue({
      ...me,
      memberships: [{ ...me.memberships[0], accessLevel: 'MANAGER' }],
    });
    renderAt('/orgs/o1/me/shifts');
    expect(await screen.findByRole('link', { name: 'Schedule' })).toHaveAttribute(
      'href',
      '/orgs/o1/schedule',
    );
    expect(screen.getByRole('link', { name: 'Offer review' })).toHaveAttribute(
      'href',
      '/orgs/o1/review',
    );
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/orgs/o1/members',
    );
  });

  describe('mobile nav scroll', () => {
    const scrollIntoView = vi.fn();
    const navScrollTo = vi.fn();
    const windowScrollTo = vi.fn();
    const restore: (() => void)[] = [];
    let observers: { targets: Element[]; fire: () => void }[] = [];
    /**
     * jsdom has no layout: fake a 390 px nav (padding box 0..390, already scrolled 100 px)
     * whose active pill sits at 600..700, plus ResizeObserver and the reduced-motion query.
     */
    function fakeLayout(reduced: boolean) {
      const proto = HTMLElement.prototype;
      const saved = (['scrollWidth', 'clientWidth', 'scrollLeft'] as const).map(
        (k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const,
      );
      Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => 800 });
      Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 390 });
      Object.defineProperty(proto, 'scrollLeft', { configurable: true, get: () => 100 });
      const rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const [left, right] =
          this.getAttribute('aria-current') === 'page'
            ? [600, 700]
            : this.tagName === 'NAV'
              ? [0, 390]
              : [0, 0];
        return { left, right, top: 0, bottom: 0, width: right - left, height: 0 } as DOMRect;
      };
      const siv = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      const sto = Element.prototype.scrollTo;
      Element.prototype.scrollTo = navScrollTo as typeof Element.prototype.scrollTo;
      const wsto = window.scrollTo;
      window.scrollTo = windowScrollTo as typeof window.scrollTo;
      const ro = globalThis.ResizeObserver;
      observers = [];
      globalThis.ResizeObserver = class {
        targets: Element[] = [];
        constructor(cb: () => void) {
          observers.push({ targets: this.targets, fire: cb });
        }
        observe(el: Element) {
          this.targets.push(el);
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      const mm = window.matchMedia;
      window.matchMedia = ((q: string) => ({
        matches: reduced && q === '(prefers-reduced-motion: reduce)',
        media: q,
      })) as unknown as typeof window.matchMedia;
      restore.push(() => {
        for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft']) delete (proto as never)[k];
        for (const [k, d] of saved) if (d) Object.defineProperty(Element.prototype, k, d);
        Element.prototype.getBoundingClientRect = rect;
        Element.prototype.scrollIntoView = siv;
        Element.prototype.scrollTo = sto;
        window.scrollTo = wsto;
        window.matchMedia = mm;
        globalThis.ResizeObserver = ro;
      });
    }
    afterEach(() => {
      restore.splice(0).forEach((r) => r());
      for (const f of [scrollIntoView, navScrollTo, windowScrollTo]) f.mockReset();
    });

    const mount = async (reduced = false) => {
      fakeLayout(reduced);
      apiFetch.mockResolvedValue(me);
      renderAt('/orgs/o1/offers');
      await screen.findByText('offers page');
      return screen.getByRole('navigation', { name: 'Main' });
    };

    it('scrolls only the nav row so the active pill is fully visible on mount', async () => {
      const nav = await mount();
      // Pill right edge 700 - 390 visible = 310 more than the current 100.
      expect(navScrollTo).toHaveBeenCalledTimes(1);
      expect(navScrollTo.mock.contexts[0]).toBe(nav);
      expect(navScrollTo).toHaveBeenCalledWith({ left: 410, behavior: 'smooth' });
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(windowScrollTo).not.toHaveBeenCalled();
    });

    it('re-reveals on resize without touching the page scroll, until the user touches the nav', async () => {
      const nav = await mount();
      expect(observers).toHaveLength(1);
      expect(observers[0].targets.length).toBeGreaterThan(0);
      const y = window.scrollY;

      act(() => observers[0].fire());
      expect(navScrollTo).toHaveBeenCalledTimes(2);
      expect(navScrollTo.mock.contexts[1]).toBe(nav);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(windowScrollTo).not.toHaveBeenCalled();
      expect(window.scrollY).toBe(y);

      fireEvent.pointerDown(nav);
      act(() => observers[0].fire());
      expect(navScrollTo).toHaveBeenCalledTimes(2);
    });

    it('stops re-revealing after the page has been scrolled', async () => {
      await mount();
      fireEvent.scroll(window);
      act(() => observers[0].fire());
      expect(navScrollTo).toHaveBeenCalledTimes(1);
    });

    it('jumps without animation under reduced motion', async () => {
      await mount(true);
      expect(navScrollTo).toHaveBeenCalledWith({ left: 410, behavior: 'auto' });
    });
  });
});
