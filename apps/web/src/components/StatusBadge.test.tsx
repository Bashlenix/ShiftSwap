import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each([
    ['OPEN', 'Open'],
    ['FILLED', 'Filled'],
    ['CANCELLED', 'Cancelled'],
    ['EXPIRED', 'Expired'],
    ['PENDING', 'Pending'],
    ['SELECTED', 'Selected'],
  ] as const)('shows text for %s', (status, text) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeVisible();
  });
});
