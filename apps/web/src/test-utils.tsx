import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { OrgContext, type OrgInfo } from './features/org/useOrg';

export const TEST_ORG: OrgInfo = {
  organizationId: 'org-1',
  membershipId: 'mem-1',
  organizationName: 'Café Lindenhof',
  accessLevel: 'EMPLOYEE',
  timezone: 'Europe/Berlin',
  offerLeadTimeMin: 120,
};

export function renderWithOrg(ui: ReactElement, org: OrgInfo = TEST_ORG) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrgContext.Provider value={org}>
        <MemoryRouter>{ui}</MemoryRouter>
      </OrgContext.Provider>
    </QueryClientProvider>,
  );
}
