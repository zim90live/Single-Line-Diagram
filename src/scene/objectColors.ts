import type { AnchorType } from '../domain/project'

export const DEFAULT_BUSBAR_COLOR = '#D5B96F'

const DEFAULT_CONNECTION_COLORS: Record<AnchorType, string> = {
  electrical: '#D5B96F',
  'cooling-primary-cold': '#FCBC00',
  'cooling-primary-hot': '#FB7800',
  'cooling-secondary-cold': '#1BA4FF',
  'cooling-secondary-hot': '#00B387',
  'cooling-tertiary-cold': '#7C5CFF',
  'cooling-tertiary-hot': '#F06BD8',
  'cooling-general': '#B6B8B4',
}

export function defaultConnectionColor(type: AnchorType) {
  return DEFAULT_CONNECTION_COLORS[type]
}

export function normalizeHexColor(rawColor: string, fallback: string) {
  const candidate = rawColor.trim().toUpperCase()
  const withPrefix = candidate.startsWith('#') ? candidate : `#${candidate}`
  return /^#[0-9A-F]{6}$/.test(withPrefix) ? withPrefix : fallback
}

export function isHexColor(rawColor: string) {
  return /^#?[0-9a-f]{6}$/i.test(rawColor.trim())
}

export interface HsvColor {
  h: number
  s: number
  v: number
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function hexToHsv(rawColor: string, fallback = DEFAULT_BUSBAR_COLOR): HsvColor {
  const hex = normalizeHexColor(rawColor, fallback).slice(1)
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }

  return {
    h: (hue + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max,
  }
}

export function hsvToHex({ h, s, v }: HsvColor) {
  const hue = ((h % 360) + 360) % 360
  const saturation = clampUnit(s)
  const value = clampUnit(v)
  const chroma = value * saturation
  const section = hue / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const match = value - chroma
  const [red, green, blue] = section < 1
    ? [chroma, secondary, 0]
    : section < 2
      ? [secondary, chroma, 0]
      : section < 3
        ? [0, chroma, secondary]
        : section < 4
          ? [0, secondary, chroma]
          : section < 5
            ? [secondary, 0, chroma]
            : [chroma, 0, secondary]
  return `#${[red, green, blue].map((channel) => (
    Math.round((channel + match) * 255).toString(16).padStart(2, '0')
  )).join('').toUpperCase()}`
}
