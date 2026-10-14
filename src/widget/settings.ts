/**
 * Widget settings shared by the background service worker and the widget UI.
 *
 * The option tables live here so the context menu, the window sizing and the
 * theme attribute applied in the widget cannot drift apart.
 */

export const WIDGET_COLOR_KEY = 'widgetColor'
export const WIDGET_SIZE_KEY = 'widgetSize'

export const COLOR_OPTIONS = [
  { id: 'green', label: '💚 Green', accent: '#7cffaf' },
  { id: 'pearl', label: '💧 Pearl Aqua', accent: '#78dae4' },
  { id: 'magenta', label: '💜 Hyper Magenta', accent: '#b026ff' },
  { id: 'fuchsia', label: '💖 Hot Fuchsia', accent: '#ff1654' },
  { id: 'lime', label: '💛 Lime Cream', accent: '#fffd98' },
] as const

/** Window outer sizes: the popup includes ~30px of browser chrome around the content. */
export const SIZE_OPTIONS = [
  { id: 'normal', label: '◽ Normal', width: 280, height: 390 },
  { id: 'large', label: '◼️ Large', width: 400, height: 610 },
] as const

export type ColorOption = typeof COLOR_OPTIONS[number]
export type SizeOption = typeof SIZE_OPTIONS[number]

export type WidgetColor = ColorOption['id']
export type WidgetSize = SizeOption['id']

export interface WidgetSettings {
  color: WidgetColor
  size: WidgetSize
}

export const DEFAULT_WIDGET_COLOR: WidgetColor = 'green'
export const DEFAULT_WIDGET_SIZE: WidgetSize = 'normal'

export function findColorOption(id: string | null | undefined): ColorOption | undefined {
  return COLOR_OPTIONS.find(option => option.id === id)
}

export function findSizeOption(id: string | null | undefined): SizeOption | undefined {
  return SIZE_OPTIONS.find(option => option.id === id)
}

/**
 * Read `{ color, size }` out of a raw `chrome.storage.local` record, falling
 * back to the defaults for missing or unknown values.
 */
export function parseWidgetSettings(raw: unknown): WidgetSettings {
  const record = (raw ?? {}) as Record<string, unknown>
  return {
    color: findColorOption(readString(record, WIDGET_COLOR_KEY))?.id ?? DEFAULT_WIDGET_COLOR,
    size: findSizeOption(readString(record, WIDGET_SIZE_KEY))?.id ?? DEFAULT_WIDGET_SIZE,
  }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}
