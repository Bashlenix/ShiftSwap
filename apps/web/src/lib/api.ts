export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as T;
}
