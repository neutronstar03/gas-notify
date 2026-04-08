export function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function mustGetElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing required element: ${id}`)
  }

  return element as T
}
