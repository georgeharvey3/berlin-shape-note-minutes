// The draft minutes of one singing, as the minutes taker records them.
//
// A draft lives in localStorage on one device until the minutes taker sends
// it to the sheet. A handover moves it to another device as readable text.
//
// A call keeps the page only. The title comes from the book each time the app
// shows the call, so the page is the one truth, as it is in the sheet.

import { useCallback, useEffect, useState } from 'react'
import { foldTitle } from './books.js'

const DRAFT_KEY = 'bsnm-minutes-draft-v1'
const LAST_EVENT_KEY = 'bsnm-minutes-last-event-v1'
const PASSWORD_KEY = 'bsnm-minutes-password-v1'

// localStorage can throw in a private window or with blocked site data. A
// failed read gives nothing, and a failed write keeps the value for this
// visit only.
function read(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Nothing to do.
  }
}

function readDraft() {
  try {
    const parsed = JSON.parse(read(DRAFT_KEY) ?? 'null')
    return parsed && Array.isArray(parsed.calls) ? parsed : null
  } catch {
    return null
  }
}

/**
 * The draft of this device, and a setter that also stores it. The setter
 * takes a new draft, a function of the old draft, or null to clear it.
 */
export function useDraft() {
  const [draft, setDraft] = useState(readDraft)

  // A second tab of the app writes the same draft.
  useEffect(() => {
    function onStorage(event) {
      if (event.key === DRAFT_KEY) setDraft(readDraft())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = useCallback((next) => {
    setDraft((previous) => {
      const value = typeof next === 'function' ? next(previous) : next
      write(DRAFT_KEY, value ? JSON.stringify(value) : null)
      return value
    })
  }, [])

  return [draft, update]
}

export const lastEvent = {
  get: () => read(LAST_EVENT_KEY),
  set: (value) => write(LAST_EVENT_KEY, value),
}

export const savedPassword = {
  get: () => read(PASSWORD_KEY),
  set: (value) => write(PASSWORD_KEY, value),
}

export function newId() {
  return Math.random().toString(36).slice(2, 10)
}

export function newDraft({ event, date, bookId }) {
  return { id: newId(), event, date, bookId, status: 'recording', calls: [] }
}

export function todayIso() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// "2026-09-25" to "25.09.2026", the format of the sheets since 2026.
export function germanDate(iso) {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

function isoFromGerman(text) {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim())
  if (!match) return null
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

export function leaderLabel(leaders) {
  return leaders.join(' and ')
}

// ---------- the songs of a book ----------

/**
 * The songs of the edition the singers use now, with a lookup by page.
 * `book` is the result of `buildBook`.
 */
export function currentSongs(book) {
  const entries = book.songs
    .map((song) => song.editions[book.currentEdition])
    .filter(Boolean)
  const byPage = new Map(entries.map((entry) => [entry.page.toLowerCase(), entry]))
  return { entries, byPage }
}

/**
 * The songs that the text in the song field can mean, best first.
 *
 * A page that the book has comes first. A bare number whose page the book cuts
 * into a top half and a bottom half gives both halves, so "178" offers "178t"
 * and "178b". Text that is not a page number also searches the titles.
 */
export function songChoices(songs, input, limit = 6) {
  const text = input.trim()
  if (text === '') return []
  const lower = text.toLowerCase()
  const choices = []

  const exact = songs.byPage.get(lower)
  if (exact) choices.push(exact)

  if (/^\d+$/.test(text)) {
    for (const entry of songs.entries) {
      if (entry !== exact && entry.number === Number(text) && /^\d+[tb]$/i.test(entry.page)) {
        choices.push(entry)
      }
    }
  }

  const fold = foldTitle(text)
  if (fold.length >= 2 && !/^\d/.test(text)) {
    const starts = songs.entries.filter((entry) => entry.fold.startsWith(fold))
    const inside = songs.entries.filter(
      (entry) => !entry.fold.startsWith(fold) && entry.fold.includes(fold),
    )
    for (const entry of [...starts, ...inside]) {
      if (!choices.includes(entry)) choices.push(entry)
    }
  }

  return choices.slice(0, limit)
}

// ---------- the leaders ----------

/**
 * What the minutes already know about the leaders and the events.
 *
 * `calls` holds the cleaned calls of every book. The result ranks each leader
 * by the calls of the last year, so a regular comes before a visitor of 2021.
 */
export function leaderHistory(calls) {
  const latest = calls.reduce((max, call) => (call.date > max ? call.date : max), '')
  const cutoff = (days) => {
    if (!latest) return ''
    const date = new Date(`${latest}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - days)
    return date.toISOString().slice(0, 10)
  }
  const recent = cutoff(56)
  const lastYear = cutoff(365)

  const leaders = new Map()
  const events = new Map()
  for (const call of calls) {
    const name = call.leader.trim()
    if (name !== '') {
      const entry = leaders.get(name) ?? { name, fold: foldTitle(name), recent: 0, year: 0, total: 0 }
      entry.total += 1
      if (call.date >= lastYear) entry.year += 1
      if (call.date >= recent) entry.recent += 1
      leaders.set(name, entry)
    }
    const event = call.event.trim()
    if (event !== '' && (events.get(event) ?? '') < call.date) events.set(event, call.date)
  }

  const ranked = [...leaders.values()].sort(
    (a, b) => b.year - a.year || b.total - a.total || a.name.localeCompare(b.name),
  )
  return {
    ranked,
    // The leaders of the last eight weeks, most calls first.
    regulars: ranked
      .filter((entry) => entry.recent > 0)
      .sort((a, b) => b.recent - a.recent)
      .map((entry) => entry.name),
    // The events, the one used last first.
    events: [...events.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name),
  }
}

export function leaderSuggestions(history, input, limit = 6) {
  const fold = foldTitle(input)
  if (fold === '') return []
  const words = (entry) => entry.fold.split(' ')
  const starts = history.ranked.filter((entry) => words(entry).some((word) => word.startsWith(fold)))
  const inside = history.ranked.filter(
    (entry) => !starts.includes(entry) && entry.fold.includes(fold),
  )
  return [...starts, ...inside].slice(0, limit).map((entry) => entry.name)
}

// ---------- the send ----------

/** The calls of each book, in the order of the singing. */
export function callsByBook(draft) {
  const books = {}
  for (const call of draft.calls) {
    ;(books[call.bookId] ??= []).push({
      leader: leaderLabel(call.leaders),
      page: call.page,
      notes: call.notes,
    })
  }
  return books
}

// ---------- the handover ----------

const HANDOVER_TITLE = 'Berlin Shape Note Minutes: draft'

/**
 * The draft as readable text. It reads as minutes, and `parseHandover` reads
 * it back:
 *
 *   Berlin Shape Note Minutes: draft
 *   Event: Thursday Singing at Refugio
 *   Date: 25.09.2026
 *   Now: Shenandoah Harmony
 *
 *   Sacred Harp
 *   1. Luis Aue – 448b The Grieved Soul
 *   2. Anna and Rose – 71 Hickman · Note: for Jakob
 *
 *   Shenandoah Harmony
 *   3. …
 *
 * A song that the book does not have shows its page alone.
 */
export function formatHandover(draft, books, lookups) {
  const label = (bookId) => books.find((book) => book.id === bookId)?.label ?? bookId
  const lines = [
    HANDOVER_TITLE,
    `Event: ${draft.event}`,
    `Date: ${germanDate(draft.date)}`,
    `Now: ${label(draft.bookId)}`,
  ]
  let bookId = null
  draft.calls.forEach((call, index) => {
    if (call.bookId !== bookId) {
      bookId = call.bookId
      lines.push('', label(bookId))
    }
    const song = lookups[call.bookId]?.byPage.get(call.page.toLowerCase())
    const note = call.notes ? ` · Note: ${call.notes}` : ''
    lines.push(
      `${index + 1}. ${leaderLabel(call.leaders)} – ${song ? `${song.page} ${song.title}` : call.page}${note}`,
    )
  })
  return lines.join('\n')
}

/**
 * Read a handover text back into a draft. It throws with a message for the
 * minutes taker when the text is not a handover.
 *
 * A messenger can change a dash or a quote, so the parser takes a hyphen, an
 * en dash or an em dash. It trusts the page and not the title: the title comes
 * from the book again.
 */
export function parseHandover(text, books, lookups) {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const labels = new Map(books.map((book) => [book.label.toLowerCase(), book.id]))
  const field = (name) => {
    const line = lines.find((each) => each.toLowerCase().startsWith(`${name.toLowerCase()}:`))
    return line ? line.slice(name.length + 1).trim() : null
  }

  const event = field('Event')
  const date = isoFromGerman(field('Date') ?? '')
  if (event === null || date === null) {
    throw new Error('This text is not a handover. It needs an "Event:" line and a "Date:" line.')
  }

  let bookId = labels.get((field('Now') ?? '').toLowerCase()) ?? null
  let current = null
  const calls = []
  for (const line of lines) {
    const heading = labels.get(line.toLowerCase())
    if (heading) {
      current = heading
      continue
    }
    const match = /^\d+\.\s+(.+?)\s+[-–—]\s+(.+)$/.exec(line)
    if (!match) continue
    if (!current) throw new Error(`The call "${line}" has no book above it.`)
    let [, leaders, rest] = match
    let notes = ''
    const noteAt = rest.search(/\s+·\s+Note:\s*/i)
    if (noteAt >= 0) {
      notes = rest.slice(noteAt).replace(/^\s+·\s+Note:\s*/i, '')
      rest = rest.slice(0, noteAt)
    }
    const first = rest.split(/\s+/)[0]
    const known = lookups[current]?.byPage.get(first.toLowerCase())
    calls.push({
      id: newId(),
      bookId: current,
      leaders: leaders.split(/\s+and\s+/).map((name) => name.trim()).filter(Boolean),
      page: known ? known.page : rest.trim(),
      notes: notes.trim(),
    })
  }

  if (calls.length === 0 && !bookId) {
    throw new Error('This text holds no call and no book.')
  }
  bookId ??= calls[calls.length - 1].bookId
  return { id: newId(), event, date, bookId, status: 'recording', calls }
}

// ---------- the post ----------

/**
 * The minutes as a post for the Facebook page of the singers:
 *
 *   Minutes for the Thursday Singing, 10.09.26 at Refugio. We sang 39 songs: 20 from the Shenandoah Harmony and 19 from the Sacred Harp.
 *   Shenandoah Harmony
 *   Caro Stamm-Reusch 12b Stroudwater
 *   Petra Ertl 235 Baltimore for Molly Adrienne
 *   Caitlin Jay 53 Lisbon - Farewell, dear brethren of the Lord
 *
 * The date goes before the place, so an event "Thursday Singing at Refugio"
 * splits at its last " at ". The books come in the order of the singing.
 */
export function formatPost(draft, books, lookups) {
  const label = (bookId) => books.find((book) => book.id === bookId)?.label ?? bookId
  const [year, month, day] = draft.date.split('-')
  const date = `${day}.${month}.${year.slice(2)}`
  const at = draft.event.lastIndexOf(' at ')
  const heading =
    at > 0
      ? `Minutes for the ${draft.event.slice(0, at)}, ${date}${draft.event.slice(at)}.`
      : `Minutes for the ${draft.event}, ${date}.`

  const groups = []
  for (const call of draft.calls) {
    const last = groups[groups.length - 1]
    if (last && last.bookId === call.bookId) last.calls.push(call)
    else groups.push({ bookId: call.bookId, calls: [call] })
  }

  const totals = new Map()
  for (const call of draft.calls) totals.set(call.bookId, (totals.get(call.bookId) ?? 0) + 1)
  const songs = (count) => `${count} ${count === 1 ? 'song' : 'songs'}`
  const parts = [...totals].map(([bookId, count]) => `${count} from the ${label(bookId)}`)
  let summary
  if (totals.size === 0) summary = 'We sang no songs.'
  else if (totals.size === 1) summary = `We sang ${songs(draft.calls.length)} from the ${label([...totals.keys()][0])}.`
  else summary = `We sang ${songs(draft.calls.length)}: ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`

  const lines = [`${heading} ${summary}`]
  for (const group of groups) {
    lines.push(label(group.bookId))
    for (const call of group.calls) {
      const song = lookups[call.bookId]?.byPage.get(call.page.toLowerCase())
      let line = `${leaderLabel(call.leaders)} ${song ? `${song.page} ${song.title}` : call.page}`
      const note = (call.notes ?? '').trim()
      // "for Tobias" reads on from the title. Any other note stands apart.
      if (note) line += /^for\b/i.test(note) ? ` ${note}` : ` - ${note}`
      lines.push(line)
    }
  }
  return lines.join('\n')
}
