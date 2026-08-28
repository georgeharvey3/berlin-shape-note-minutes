import { findSong, foldTitle, pageOrder } from './books.js'

// Column names in the "Minutes" sheets. The sheet owners type these headers,
// so keep the lookup tolerant: match on a prefix of the header. The Sacred
// Harp sheet writes "Name(s) of Leaders" and the Shenandoah sheet writes
// "Name(s)". The Sacred Harp sheet of 2021 has no header over the first
// column, so `order` can be absent.
const COLUMN_PREFIXES = {
  order: 'Order of entry',
  event: 'Event',
  date: 'Date',
  leaders: 'Name(s)',
  page: 'Page',
  title: 'Song Title',
  notes: 'Notes',
}

function pickColumns(sample) {
  const keys = Object.keys(sample)
  const map = {}
  for (const [field, prefix] of Object.entries(COLUMN_PREFIXES)) {
    map[field] = keys.find((key) => key.startsWith(prefix)) ?? null
  }
  return map
}

function pad(value) {
  return value.padStart(2, '0')
}

// The sheets hold two date formats. The minutes up to 2025 hold US dates
// (m/d/yyyy). The minutes of 2026 hold German dates (dd.mm.yyyy). The
// separator tells them apart, so no sheet needs a setting.
function parseSheetDate(value) {
  const text = value.trim()
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  if (german) return { day: pad(german[1]), month: pad(german[2]), year: Number(german[3]) }
  const american = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (american) return { day: pad(american[2]), month: pad(american[1]), year: Number(american[3]) }
  return null
}

function isoDate({ year, month, day }) {
  return `${year}-${month}-${day}`
}

/**
 * Clean the raw rows of one year sheet.
 *
 * Three defects in the source data need a fix:
 *  - Empty rows and rows where the lookup formula still shows "#N/A".
 *  - Fill-down damage in the Date column: a block of rows inside one singing
 *    carries the same day and month but an incremented year (02.04.2027,
 *    02.04.2028 ...). Those years do not exist in the minutes, so a row whose
 *    day and month match a real singing day is moved back to that year.
 *  - A row with such a year whose day and month match no singing day. Nothing
 *    can place it, so it goes out with the dropped rows.
 */
export function cleanRows(rawRows) {
  if (rawRows.length === 0) {
    return { calls: [], repairedDates: 0, droppedRows: 0, mainYear: null }
  }
  const columns = pickColumns(rawRows[0])

  const parsed = rawRows.map((row, index) => ({
    order: (columns.order ? Number(row[columns.order]) : NaN) || index + 1,
    event: row[columns.event] ?? '',
    date: parseSheetDate(row[columns.date] ?? ''),
    leader: row[columns.leaders] ?? '',
    page: row[columns.page] ?? '',
    title: row[columns.title] ?? '',
    notes: row[columns.notes] ?? '',
  }))

  const usable = parsed.filter(
    (row) => row.date && row.page !== '' && row.title !== '' && !row.title.startsWith('#'),
  )

  const yearCounts = new Map()
  for (const row of usable) {
    yearCounts.set(row.date.year, (yearCounts.get(row.date.year) ?? 0) + 1)
  }
  // The year that carries the minutes. Everything else is fill-down damage.
  const mainYear = usable.length === 0 ? null : [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

  const realDays = new Set(
    usable
      .filter((row) => row.date.year === mainYear)
      .map((row) => `${row.date.day}.${row.date.month}`),
  )

  let repairedDates = 0
  let orphanRows = 0
  const calls = []
  for (const row of usable) {
    let { year } = row.date
    if (year !== mainYear) {
      if (!realDays.has(`${row.date.day}.${row.date.month}`)) {
        orphanRows += 1
        continue
      }
      year = mainYear
      repairedDates += 1
    }
    const date = { ...row.date, year }
    calls.push({
      order: row.order,
      event: row.event,
      year,
      date: isoDate(date),
      dateLabel: `${date.day}.${date.month}.${date.year}`,
      leader: row.leader,
      page: row.page,
      title: row.title,
      notes: row.notes,
    })
  }

  calls.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)

  return {
    calls,
    repairedDates,
    droppedRows: parsed.length - usable.length + orphanRows,
    mainYear,
  }
}

/**
 * Read every year sheet and join the rows into one list of calls.
 *
 * `sheets` is a list of `{ sheet, rows }`, one entry per year.
 */
export function cleanAllRows(sheets) {
  const calls = []
  let repairedDates = 0
  let droppedRows = 0
  const years = new Set()

  for (const { sheet, rows } of sheets) {
    const cleaned = cleanRows(rows)
    repairedDates += cleaned.repairedDates
    droppedRows += cleaned.droppedRows
    for (const call of cleaned.calls) {
      calls.push({ ...call, sheetKey: sheet.key })
      years.add(call.year)
    }
  }

  calls.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
  return { calls, repairedDates, droppedRows, years: [...years].sort((a, b) => a - b) }
}

/**
 * Say which edition of the book the singers used on each singing day.
 *
 * A book with one edition gives that edition to every day. In a book with two
 * editions the evidence is the page and the title of each call. A page and
 * title that only one edition has names that edition. A day with no such call
 * takes the edition of the day before it, because the change of the edition
 * runs one way: once the singers use the newer edition, they never go back.
 */
export function assignEditions(calls, book) {
  const days = [...new Set(calls.map((call) => call.date))].sort()
  if (book.editionIds.length === 1) {
    return new Map(days.map((day) => [day, book.editionIds[0]]))
  }

  const [older, newer] = book.editionIds
  const evidence = new Map()
  for (const call of calls) {
    const fold = foldTitle(call.title)
    const page = call.page.trim()
    const inOld = book.byPageTitle.has(`${older}|${page}|${fold}`)
    const inNew = book.byPageTitle.has(`${newer}|${page}|${fold}`)
    if (inOld === inNew) continue
    const counts = evidence.get(call.date) ?? { [older]: 0, [newer]: 0 }
    counts[inNew ? newer : older] += 1
    evidence.set(call.date, counts)
  }

  const editions = new Map()
  let latest = null
  for (const day of days) {
    const counts = evidence.get(day)
    let edition = latest
    if (counts) {
      if (counts[newer] > counts[older]) edition = newer
      else if (counts[older] > counts[newer]) edition = older
    }
    // The change runs one way, so a later day never returns to the older
    // edition.
    if (latest === newer) edition = newer
    editions.set(day, edition)
    if (edition) latest = edition
  }
  // A day before the first day with evidence takes the first known edition.
  const firstKnown = days.map((day) => editions.get(day)).find(Boolean) ?? book.currentEdition
  for (const day of days) {
    if (!editions.get(day)) editions.set(day, firstKnown)
  }

  return editions
}

/**
 * Attach the song of the book to each call.
 *
 * A call that matches no song of the book keeps `songId` null. The Sacred Harp
 * sheets hold seven such rows: a typed page such as "???" or "Xxx", and two
 * German carols that the book does not have.
 */
export function resolveCalls(calls, book) {
  const editions = assignEditions(calls, book)
  let offBookCalls = 0
  const resolved = calls.map((call) => {
    const edition = editions.get(call.date) ?? book.currentEdition
    const song = findSong(book, edition, call.page, call.title)
    if (!song) offBookCalls += 1
    return { ...call, edition, songId: song ? song.id : null }
  })
  return { calls: resolved, editions, offBookCalls }
}

/** The editions that the given calls used. */
export function editionsOf(calls) {
  return new Set(calls.map((call) => call.edition))
}

/**
 * Build the song list.
 *
 * `songs` holds the songs of the book that the chosen years are about. A song
 * with no call gets a count of 0, so the dashboard can show the songs that
 * nobody called. `editions` says which page and title to show: the newer
 * edition wins when the chosen years use it.
 */
export function buildLeaderboard(calls, book, songs = [], editions = null) {
  const [older, newer] = [book.editionIds[0], book.currentEdition]
  const inUse = editions ?? new Set([book.currentEdition])
  const showNew = inUse.has(newer)
  const board = new Map()

  function label(song) {
    const shown = (showNew ? song.editions[newer] : null) ?? song.editions[older] ?? song.editions[newer]
    const before = song.editions[older]
    const movedFrom =
      showNew && before && song.editions[newer] && before.page !== song.editions[newer].page
        ? before.page
        : null
    return { page: shown.page, title: shown.title, movedFrom, order: shown.order, entry: shown }
  }

  for (const song of songs) {
    const shown = label(song)
    board.set(song.id, {
      key: song.id,
      page: shown.page,
      title: shown.title,
      movedFrom: shown.movedFrom,
      source: shown.entry.source,
      mode: shown.entry.mode,
      status: song.status,
      editions: song.editions,
      bookOrder: shown.order,
      count: 0,
      calls: [],
    })
  }

  for (const call of calls) {
    const key = call.songId ?? `off:${call.page}|${foldTitle(call.title)}`
    let song = board.get(key)
    if (!song) {
      song = {
        key,
        page: call.page,
        title: call.title,
        movedFrom: null,
        source: '',
        mode: '',
        status: call.songId ? 'both' : 'off-book',
        editions: {},
        bookOrder: pageOrder(call.page),
        count: 0,
        calls: [],
      }
      board.set(key, song)
    }
    song.count += 1
    song.calls.push(call)
  }

  const leaderboard = [...board.values()].sort(
    (a, b) => b.count - a.count || a.bookOrder - b.bookOrder,
  )

  // Rank the called songs only. A song with no call has no rank.
  const called = leaderboard.filter((song) => song.count > 0)
  let rank = 0
  let previousCount = null
  called.forEach((song, index) => {
    if (song.count !== previousCount) {
      rank = index + 1
      previousCount = song.count
    }
    song.rank = rank
  })

  leaderboard.forEach((song) => {
    if (song.count === 0) song.rank = null
    song.calls.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
    song.leaders = [...new Set(song.calls.map((call) => call.leader).filter(Boolean))]
    song.years = [...new Set(song.calls.map((call) => call.year))].sort((a, b) => a - b)
  })

  return leaderboard
}

/** The songs of the book that the given editions have. */
export function songsInEditions(book, editions) {
  return book.songs.filter((song) => [...editions].some((edition) => song.editions[edition]))
}

export function summarise(calls, leaderboard) {
  return {
    totalCalls: calls.length,
    uniqueSongs: leaderboard.filter((song) => song.count > 0).length,
    uncalledSongs: leaderboard.filter((song) => song.count === 0).length,
    singingDays: new Set(calls.map((call) => call.date)).size,
    leaders: new Set(calls.map((call) => call.leader).filter(Boolean)).size,
  }
}

// A search matches a song on the title or the page of any edition, so "178"
// and "178t" both find "Africa", and "Ode on Life's Journey" finds the song
// that page 227 now calls "Ode of Life's Journey".
export function matchesQuery(song, query) {
  const needle = foldTitle(query)
  if (needle === '') return true
  const entries = Object.values(song.editions)
  const titles = [song.title, ...entries.map((entry) => entry?.title)]
  if (titles.some((title) => title && foldTitle(title).includes(needle))) return true
  const pages = [song.page, ...entries.map((entry) => entry?.page)]
  return pages.some((page) => page && page.toLowerCase().startsWith(needle))
}

// The leader names that the query matches, in order of the number of calls.
export function findLeaders(calls, query) {
  const needle = foldTitle(query)
  if (needle === '') return []
  const counts = new Map()
  for (const call of calls) {
    if (!call.leader) continue
    if (!foldTitle(call.leader).includes(needle)) continue
    counts.set(call.leader, (counts.get(call.leader) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

// The calls of the given leaders only.
export function callsByLeaders(calls, names) {
  const wanted = new Set(names)
  return calls.filter((call) => wanted.has(call.leader))
}
