import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { OrgPickerPage } from './features/orgs/OrgPickerPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/orgs', element: <OrgPickerPage /> },
      {
        path: '/orgs/:organizationId',
        element: <main className="p-4">Organisation home is coming soon.</main>,
      },
    ],
  },
  { path: '/', element: <Navigate to="/orgs" replace /> },
  { path: '*', element: <Navigate to="/orgs" replace /> },
]);
