import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { SignUpPage } from './features/auth/SignUpPage';
import { AccountPage } from './features/account/AccountPage';
import { AcceptInvitePage } from './features/invites/AcceptInvitePage';
import { CreateOrgPage } from './features/orgs/CreateOrgPage';
import { AuditPage } from './features/audit/AuditPage';
import { AvailabilityPage } from './features/availability/AvailabilityPage';
import { MembersPage } from './features/members/MembersPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { OpenOffersPage } from './features/offers/OpenOffersPage';
import { OfferReviewPage } from './features/review/OfferReviewPage';
import { SchedulePage } from './features/schedule/SchedulePage';
import { OrgLayout } from './features/org/OrgLayout';
import { OrgPickerPage } from './features/orgs/OrgPickerPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { MyShiftsPage } from './features/shifts/MyShiftsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/invites/:token', element: <AcceptInvitePage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/orgs', element: <OrgPickerPage /> },
      { path: '/account', element: <AccountPage /> },
      { path: '/orgs/new', element: <CreateOrgPage /> },
      {
        path: '/orgs/:orgId',
        element: <OrgLayout />,
        children: [
          { index: true, element: <Navigate to="me/shifts" replace /> },
          { path: 'me/shifts', element: <MyShiftsPage /> },
          { path: 'offers', element: <OpenOffersPage /> },
          { path: 'me/availability', element: <AvailabilityPage /> },
          { path: 'schedule', element: <SchedulePage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'review', element: <OfferReviewPage /> },
          { path: 'review/:offerId', element: <OfferReviewPage /> },
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/orgs" replace /> },
  { path: '*', element: <Navigate to="/orgs" replace /> },
]);
