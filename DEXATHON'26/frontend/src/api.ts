const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '')

/** Uses same-origin /api locally and the configured backend URL in hosted builds. */
export function apiUrl(path: string): string {
  if (!configuredApiBase) return path
  return `${configuredApiBase}${path.startsWith('/') ? path : `/${path}`}`
}
