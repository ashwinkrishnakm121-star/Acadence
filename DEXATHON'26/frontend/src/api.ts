const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '')

/** Keeps local requests same-origin and targets the configured backend in hosted builds. */
export function apiUrl(path: string): string {
  if (!apiBase) return path
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`
}
