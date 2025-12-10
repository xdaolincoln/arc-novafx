import { BACKEND_URL } from '@/config/wagmi';

/**
 * Fetch wrapper that automatically adds ngrok bypass header
 * to skip ngrok free plan warning page
 */
export async function apiFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const headers = new Headers(options?.headers);
  
  // Add ngrok bypass header to skip warning page
  headers.set('ngrok-skip-browser-warning', 'true');
  
  // Ensure Content-Type is set for POST/PUT requests if not already set
  if ((options?.method === 'POST' || options?.method === 'PUT' || options?.method === 'PATCH') && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  
  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Fetch JSON from API endpoint
 */
export async function apiFetchJson<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await apiFetch(url, options);
  return response.json();
}

