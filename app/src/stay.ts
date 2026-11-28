import { TIME_ZONE } from './constants'
import type { DraftTransaction } from './types'

export interface Fix { lat: number; lon: number; accuracy: number; time: number; speed?: number }
export interface Stay { lat: number; lon: number; start: number; end: number; moved: boolean; mealEligible: boolean }
const minute = 60000

function distance(a: Fix, b: Fix): number {
  const rad = Math.PI / 180
  const dy = (b.lat - a.lat) * rad
  const dx = (b.lon - a.lon) * rad
  const h = Math.sin(dy / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dx / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)))
}

// Keep two fixes and motion summaries in memory. Emit once per continuous stop.
export class StayDetector {
  private last?: Fix
  private anchor?: Fix
  private lastMovement = -Infinity
  private lastDrive = -Infinity
  private walkedSinceDrive = 0
  private emitted = false

  update(p: Fix): Stay | undefined {
    if (![p.lat, p.lon, p.accuracy, p.time].every(Number.isFinite) || Math.abs(p.lat) > 90
      || Math.abs(p.lon) > 180 || p.accuracy <= 0 || p.accuracy > 35) return
    const prev = this.last
    if (prev && p.time <= prev.time) return
    this.last = p
    if (!prev || p.time - prev.time > 2 * minute) {
      this.anchor = p
      this.emitted = false
      this.lastMovement = this.lastDrive = -Infinity
      this.walkedSinceDrive = 0
      return
    }
    const step = distance(prev, p)
    const elapsed = (p.time - prev.time) / 1000
    const speed = p.speed ?? step / elapsed
    if (speed >= 4 || step / elapsed >= 5) {
      this.lastDrive = this.lastMovement = p.time
      this.walkedSinceDrive = 0
    } else if (speed >= 0.6 && speed <= 2 && step >= Math.max(7, p.accuracy, prev.accuracy)) {
      this.walkedSinceDrive += step
    }
    const anchor = this.anchor!
    if (distance(anchor, p) > 35 || speed >= 1.4) {
      this.lastMovement = p.time
      this.anchor = p
      this.emitted = false
      return
    }
    if (this.emitted || p.time - anchor.time < 15 * minute) return
    this.emitted = true
    return { lat: anchor.lat, lon: anchor.lon, start: anchor.time, end: p.time,
      moved: anchor.time - this.lastMovement <= 10 * minute,
      mealEligible: anchor.time - this.lastDrive > 20 * minute || this.walkedSinceDrive >= 35 }
  }
}

type Place = { kind: 'parking' | 'meal'; name: string; cuisine?: string }
export interface Choice { kind: Place['kind']; label: string; draft: DraftTransaction }

const cuisines: Record<string, string> = { noodle: '麵食', ramen: '拉麵', chinese: '中式餐點', japanese: '日式餐點',
  italian: '義式餐點', pizza: '披薩', burger: '漢堡', sandwich: '三明治', coffee_shop: '咖啡', breakfast: '早餐' }

export function choicesFor(stay: Stay, places: Place[]): Choice[] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(stay.start).map(p => [p.type, p.value]))
  const hour = Number(parts.hour)
  const meal = hour >= 6 && hour < 10 ? '早餐' : hour >= 11 && hour < 14 ? '午餐' : hour >= 17 && hour < 21 ? '晚餐' : ''
  const choices = new Map<string, Choice>()
  for (const place of places) {
    const parking = place.kind === 'parking'
    if (parking ? !stay.moved : !meal || !stay.mealEligible) continue
    const food = cuisines[place.cuisine ?? '']
    const note = parking ? [place.name, '停車費'].filter(Boolean).join(' · ') : [meal, place.name, food].filter(Boolean).join(' · ')
    choices.set(note, { kind: place.kind, label: note, draft: { date: [parts.year, parts.month, parts.day].join('-'),
      amount: 0, note, category: parking ? '交通' : '餐飲', account: '', type: '支出' } })
  }
  return [...choices.values()]
}

interface MapElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  tags?: Record<string, string>
}

interface Point { x: number; y: number }

// The map endpoint includes distant nodes belonging to streets that cross the box.
// Check actual geometry against the stop, including parking areas enclosing it.
function metresToGeometry(points: Point[], closed: boolean): number {
  let nearest = Infinity
  let inside = false
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[i + 1] ?? a
    const dx = b.x - a.x, dy = b.y - a.y
    const t = Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)))
    nearest = Math.min(nearest, Math.hypot(a.x + t * dx, a.y + t * dy))
    if (closed && (a.y > 0) !== (b.y > 0) && a.x - a.y * dx / dy > 0) inside = !inside
  }
  return inside ? 0 : nearest
}

export async function nearbyPlaces(stay: Stay, signal: AbortSignal): Promise<Place[]> {
  const lat = Number(stay.lat.toFixed(4)), lon = Number(stay.lon.toFixed(4))
  const lonScale = Math.max(1000, 111320 * Math.cos(lat * Math.PI / 180))
  const bounds = [Math.max(-180, lon - 100 / lonScale), Math.max(-90, lat - .0009),
    Math.min(180, lon + 100 / lonScale), Math.min(90, lat + .0009)].map(n => n.toFixed(4)).join(',')
  const response = await fetch('https://api.openstreetmap.org/api/0.6/map.json?bbox=' + bounds, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
  })
  if (!response.ok) throw new Error('附近場所服務暫時無法使用。')
  const body = await response.json() as { elements?: MapElement[] }
  if (!Array.isArray(body.elements)) throw new Error('附近場所資料不完整。')
  const nodes = new Map<number, Point>()
  for (const e of body.elements) {
    if (e.type === 'node' && e.lat != null && e.lon != null) {
      nodes.set(e.id, { x: (e.lon - stay.lon) * lonScale, y: (e.lat - stay.lat) * 111320 })
    }
  }
  const places: Place[] = []
  let onRoad = false
  for (const e of body.elements) {
    const tags = e.tags
    if (!tags || tags.access === 'private' || e.type === 'relation') continue
    const ids = e.type === 'way' ? e.nodes ?? [] : [e.id]
    const points = ids.map(id => nodes.get(id)).filter((p): p is Point => p !== undefined)
    if (points.length !== ids.length) continue
    const metres = metresToGeometry(points, ids.length > 3 && ids[0] === ids.at(-1))
    if (metres > 75) continue
    if (metres <= 12 && /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(tags.highway ?? '')) onRoad = true
    const name = tags['name:zh-Hant'] || tags['name:zh'] || tags.name || ''
    const street = ['left', 'right', 'both'].some(side => tags['parking:' + side + ':fee'] === 'yes')
    if (street || tags.amenity === 'parking' || tags.amenity === 'parking_space' || tags.amenity === 'parking_entrance') {
      if (tags.fee !== 'no') places.push({ kind: 'parking', name: name || (street ? '路邊收費區' : '附近停車場') })
    } else if (['restaurant', 'cafe', 'fast_food', 'food_court'].includes(tags.amenity)) {
      places.push({ kind: 'meal', name: name || (tags.amenity === 'cafe' ? '附近咖啡館' : '附近餐飲場所'), cuisine: tags.cuisine })
    }
  }
  return onRoad ? places.filter(p => p.kind !== 'meal') : places
}
