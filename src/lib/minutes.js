// Column names in the "Minutes 2026" sheet. The sheet owners type these
// headers, so keep the lookup tolerant: match on a prefix of the header.
const COLUMN_PREFIXES = {
  order: 'Order of entry',
  event: 'Event',
  date: 'Date',
  leaders: 'Name(s) of Leaders',
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

// The sheet holds German dates (dd.mm.yyyy).
function parseSheetDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
  if (!match) return null
  const [, day, month, year] = match
  return { day, month, year: Number(year) }
}

function isoDate({ year, month, day }) {
  return `${year}-${month}-${day}`
}

/**
 * Clean the raw sheet rows.
 *
 * Two defects in the source data need a fix:
 *  - Empty rows and rows where the lookup formula still shows "#N/A".
 *  - Fill-down damage in the Date column: a block of rows inside one singing
 *    carries the same day and month but an incremented year (02.04.2027,
 *    02.04.2028 ...). Those years do not exist in the minutes, so a row whose
 *    day and month match a real singing day is moved back to that year.
 */
export function cleanRows(rawRows) {
  if (rawRows.length === 0) return { calls: [], repairedDates: 0, droppedRows: 0 }
  const columns = pickColumns(rawRows[0])

  const parsed = rawRows.map((row) => ({
    order: Number(row[columns.order]) || null,
    event: row[columns.event] ?? '',
    rawDate: row[columns.date] ?? '',
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
  const mainYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

  const realDays = new Set(
    usable
      .filter((row) => row.date.year === mainYear)
      .map((row) => `${row.date.day}.${row.date.month}`),
  )

  let repairedDates = 0
  const calls = usable.map((row) => {
    let { year } = row.date
    const dayMonth = `${row.date.day}.${row.date.month}`
    if (year !== mainYear && realDays.has(dayMonth)) {
      year = mainYear
      repairedDates += 1
    }
    const date = { ...row.date, year }
    return {
      order: row.order,
      event: row.event,
      date: isoDate(date),
      dateLabel: `${date.day}.${date.month}.${date.year}`,
      leader: row.leader,
      page: row.page,
      title: row.title,
      notes: row.notes,
      songKey: `${row.page}|${row.title}`,
    }
  })

  calls.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return { calls, repairedDates, droppedRows: parsed.length - usable.length, mainYear }
}

/**
 * Build the song list.
 *
 * `bookSongs` holds every song in the book, from the "Song Frequency 2026"
 * sheet. A song in that list with no call gets a count of 0, so the dashboard
 * can show the songs that nobody called.
 */
export function buildLeaderboard(calls, bookSongs = []) {
  const songs = new Map()

  for (const book of bookSongs) {
    const key = `${book.page}|${book.title}`
    songs.set(key, {
      key,
      page: book.page,
      title: book.title,
      bookOrder: book.order,
      count: 0,
      calls: [],
    })
  }

  for (const call of calls) {
    let song = songs.get(call.songKey)
    if (!song) {
      song = {
        key: call.songKey,
        page: call.page,
        title: call.title,
        bookOrder: null,
        count: 0,
        calls: [],
      }
      songs.set(call.songKey, song)
    }
    song.count += 1
    song.calls.push(call)
  }

  const leaderboard = [...songs.values()].sort(
    (a, b) => b.count - a.count || pageOrder(a.page) - pageOrder(b.page),
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
    song.calls.sort((a, b) => a.date.localeCompare(b.date) || (a.order ?? 0) - (b.order ?? 0))
    song.leaders = [...new Set(song.calls.map((call) => call.leader).filter(Boolean))]
  })

  return leaderboard
}

// "48b" sorts after "48t" the way the book runs: page number, then t before b.
function pageOrder(page) {
  const match = /^(\d+)([tb]?)$/.exec(page)
  if (!match) return Number.MAX_SAFE_INTEGER
  const [, number, half] = match
  return Number(number) * 10 + (half === 'b' ? 1 : 0)
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

// Curly and straight apostrophes must match each other: the sheet writes a
// curly apostrophe in titles such as O’Leary, but users type a straight one.
function fold(value) {
  return value.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'")
}

// A search matches a song on its title or its page. Leaders are a separate
// search: see `findLeaders`.
export function matchesQuery(song, query) {
  const needle = fold(query).trim()
  if (needle === '') return true
  return fold(song.title).includes(needle) || fold(song.page).startsWith(needle)
}

// The leader names that the query matches, in order of the number of calls.
export function findLeaders(calls, query) {
  const needle = fold(query).trim()
  if (needle === '') return []
  const counts = new Map()
  for (const call of calls) {
    if (!call.leader) continue
    if (!fold(call.leader).includes(needle)) continue
    counts.set(call.leader, (counts.get(call.leader) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
}

// The calls of the given leaders only.
export function callsByLeaders(calls, names) {
  const wanted = new Set(names)
  return calls.filter((call) => wanted.has(call.leader))
}

// The "Song Frequency 2026" sheet lists every song in the book. The dashboard
// counts the calls itself, so this reader takes the page and the title only.
export function readSongIndex(rawRows) {
  return rawRows
    .map((row) => ({
      order: Number(row.Order) || null,
      page: (row.Page ?? '').trim(),
      title: (row.Title ?? '').trim(),
    }))
    .filter((song) => song.page !== '' && song.title !== '')
}
