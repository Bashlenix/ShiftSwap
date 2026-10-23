import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { authClient } from '../../lib/auth-client';

export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async function logOut() {
    try {
      await authClient.signOut();
    } finally {
      await navigate('/login');
      // Drop cached data so the next user never sees this user's data.
      queryClient.clear();
    }
  };
}
