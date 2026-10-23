import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { AvailabilityPage } from './features/availability/AvailabilityPage';
import { OpenOffersPage } from './features/offers/OpenOffersPage';
import { OrgLayout } from './features/org/OrgLayout';
import { OrgPickerPage } from './features/orgs/OrgPickerPage';
import { MyShiftsPage } from './features/shifts/MyShiftsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/orgs', element: <OrgPickerPage /> },
      {
        path: '/orgs/:orgId',
        element: <OrgLayout />,
        children: [
          { index: true, element: <Navigate to="me/shifts" replace /> },
          { path: 'me/shifts', element: <MyShiftsPage /> },
          { path: 'offers', element: <OpenOffersPage /> },
          { path: 'me/availability', element: <AvailabilityPage /> },
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/orgs" replace /> },
  { path: '*', element: <Navigate to="/orgs" replace /> },
]);
