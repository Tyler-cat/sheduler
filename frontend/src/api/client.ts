export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const defaultHeaders = {
  'content-type': 'application/json'
} as const;

export interface FetchOptions extends RequestInit {
  skipDefaultHeaders?: boolean;
}

const API_BASE = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE ?? '' : '';

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { skipDefaultHeaders, headers, ...rest } = options;
  const finalHeaders = skipDefaultHeaders ? headers : { ...defaultHeaders, ...headers };
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: finalHeaders
  });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!response.ok) {
    let message = response.statusText || 'Request failed';
    let code: string | undefined;
    if (isJson) {
      try {
        const payload = await response.json();
        message = payload?.message ?? message;
        code = payload?.code;
      } catch (error) {
        // ignore JSON parse errors and fall back to status text
      }
    }
    throw new ApiError(response.status, message, code);
  }
  if (!isJson) {
    // @ts-expect-error - allow returning empty payloads for non-JSON responses
    return undefined;
  }
  return (await response.json()) as T;
}
