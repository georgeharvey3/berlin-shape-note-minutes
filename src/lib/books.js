// The two editions of the book, and the link between them.
//
// The singers changed the book in September 2025. The 1991 revision has 557
// songs on pages 24 to 573. The 2025 revision has 590 songs on pages 26 to
// 575. The 2025 revision adds songs, removes songs, and moves a few songs to a
// new page: "Africa" moves from 178 to 178t.
//
// A song must stay one song across the two editions, so this module builds a
// crosswalk. Each song gets one `id`, and it keeps the page and the title of
// each edition it belongs to. The dashboard counts the calls of the two
// editions together under that one id.

export const EDITIONS = [
  { id: '1991', label: '1991 revision', shortLabel: '1991 book' },
  { id: '2025', label: '2025 revision', shortLabel: '2025 book' },
]

// The current edition. Its page and title are the ones the dashboard shows.
export const CURRENT_EDITION = '2025'

// Curly and straight apostrophes must match each other: the 1991 sheet writes
// a straight apostrophe in "O'Leary" and the 2025 sheet writes a curly one.
export function foldTitle(value) {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// "48b" sorts after "48t" the way the book runs: page number, then t before b.
export function pageOrder(page) {
  const match = /^(\d+)\s*([tb]?)$/.exec(page.trim())
  if (!match) return Number.MAX_SAFE_INTEGER
  const [, number, half] = match
  return Number(number) * 10 + (half === 'b' ? 1 : 0)
}

export function pageNumber(page) {
  const match = /^(\d+)/.exec(page.trim())
  return match ? Number(match[1]) : null
}

// Read one "Song Frequency" sheet. It lists every song of one edition.
export function readBookIndex(rawRows) {
  return rawRows
    .map((row) => ({
      page: (row.Page ?? '').trim(),
      title: (row.Title ?? '').trim(),
    }))
    .filter((song) => song.page !== '' && song.title !== '')
    .map((song) => ({
      ...song,
      fold: foldTitle(song.title),
      order: pageOrder(song.page),
      number: pageNumber(song.page),
    }))
}

// How close two titles are, from 0 to 1. It counts the longest common
// subsequence of the two strings, so "Reese" and "Rees" score 0.89.
function titleSimilarity(a, b) {
  if (a === b) return 1
  const rows = a.length + 1
  const columns = b.length + 1
  let previous = new Array(columns).fill(0)
  for (let i = 1; i < rows; i += 1) {
    const current = new Array(columns).fill(0)
    for (let j = 1; j < columns; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
    }
    previous = current
  }
  return (2 * previous[columns - 1]) / (a.length + b.length)
}

/**
 * Build the crosswalk between the two editions.
 *
 * The match runs in five passes, from the strictest to the loosest. Each pass
 * takes only the songs that no earlier pass matched:
 *
 *  1. Same page and same title. This matches 457 of the 557 songs of 1991.
 *  2. The title appears once in the rest of the other edition. This catches a
 *     song that moved to a new page, such as "Africa" from 178 to 178t.
 *  3. The title appears more than once. The nearest page wins. The book has
 *     eleven such titles, among them "Exhortation" and "Parting Friends".
 *  4. Same page number and a similar title. This catches a new spelling, such
 *     as "Carmathen" to "Carmarthen" on page 473.
 *  5. A very similar title on any page: "Kingwood" on 266 to "Kingswood" on
 *     323b.
 */
function crosswalk(oldIndex, newIndex) {
  const pairs = []
  let unmatchedOld = [...oldIndex]
  let unmatchedNew = [...newIndex]

  function pass(match) {
    const left = []
    for (const song of unmatchedOld) {
      const found = match(song, unmatchedNew)
      if (found) {
        unmatchedNew = unmatchedNew.filter((other) => other !== found)
        pairs.push([song, found])
      } else {
        left.push(song)
      }
    }
    unmatchedOld = left
  }

  pass((song, rest) =>
    rest.find((other) => other.page === song.page && other.fold === song.fold),
  )
  pass((song, rest) => {
    const same = rest.filter((other) => other.fold === song.fold)
    return same.length === 1 ? same[0] : null
  })
  // The nearest page wins, so run the low pages first.
  unmatchedOld.sort((a, b) => a.order - b.order)
  pass((song, rest) => {
    const same = rest.filter((other) => other.fold === song.fold)
    if (same.length === 0) return null
    return same.reduce((best, other) =>
      Math.abs(other.order - song.order) < Math.abs(best.order - song.order) ? other : best,
    )
  })
  pass((song, rest) => {
    const samePage = rest.filter((other) => other.number === song.number)
    let best = null
    let score = 0
    for (const other of samePage) {
      const value = titleSimilarity(song.fold, other.fold)
      if (value > score) {
        score = value
        best = other
      }
    }
    return score >= 0.78 ? best : null
  })
  pass((song, rest) => {
    let best = null
    let score = 0
    for (const other of rest) {
      const value = titleSimilarity(song.fold, other.fold)
      if (value > score) {
        score = value
        best = other
      }
    }
    return score >= 0.92 ? best : null
  })

  return { pairs, removed: unmatchedOld, added: unmatchedNew }
}

function songId(edition, song) {
  return `${edition}:${song.page}|${song.fold}`
}

/**
 * Build the song list of the book from the two edition sheets.
 *
 * Every song gets one entry with the page and the title of each edition it
 * belongs to. A song that only the 1991 revision has keeps the status
 * "removed". A song that only the 2025 revision has keeps the status "added".
 */
export function buildBook(indexes) {
  const oldIndex = indexes['1991'] ?? []
  const newIndex = indexes['2025'] ?? []
  const { pairs, removed, added } = crosswalk(oldIndex, newIndex)
  const songs = []

  function push(id, editions, status) {
    const current = editions['2025'] ?? editions['1991']
    songs.push({
      id,
      status,
      editions,
      page: current.page,
      title: current.title,
      fold: current.fold,
      bookOrder: current.order,
    })
  }

  for (const [oldSong, newSong] of pairs) {
    push(songId('2025', newSong), { 1991: oldSong, 2025: newSong }, 'both')
  }
  for (const song of added) push(songId('2025', song), { 1991: null, 2025: song }, 'added')
  for (const song of removed) push(songId('1991', song), { 1991: song, 2025: null }, 'removed')

  songs.sort((a, b) => a.bookOrder - b.bookOrder)

  // The lookup tables, one per edition: by page and title, and by title alone.
  const byPageTitle = new Map()
  const byTitle = new Map()
  for (const song of songs) {
    for (const edition of ['1991', '2025']) {
      const inEdition = song.editions[edition]
      if (!inEdition) continue
      byPageTitle.set(`${edition}|${inEdition.page}|${inEdition.fold}`, song)
      const titleKey = `${edition}|${inEdition.fold}`
      const found = byTitle.get(titleKey)
      byTitle.set(titleKey, found === undefined ? song : null)
    }
  }

  return { songs, byPageTitle, byTitle }
}

/**
 * Find the song of one minute row.
 *
 * `edition` is the edition the singers used on that day. The search widens
 * step by step, because the sheet holds a few typed pages that no edition has,
 * such as "???" for "Mear" and "Xxx" for a carol that is not in the book.
 */
export function findSong(book, edition, page, title) {
  const fold = foldTitle(title)
  const other = edition === '2025' ? '1991' : '2025'
  const cleanPage = page.trim()
  // The sheet also holds a title with a note in brackets at the end, such as
  // "My Home (First) (red book)". The last pass drops that note.
  const short = foldTitle(title.replace(/\s*\([^()]*\)\s*$/, ''))
  return (
    book.byPageTitle.get(`${edition}|${cleanPage}|${fold}`) ??
    book.byPageTitle.get(`${other}|${cleanPage}|${fold}`) ??
    book.byTitle.get(`${edition}|${fold}`) ??
    book.byTitle.get(`${other}|${fold}`) ??
    book.byPageTitle.get(`${edition}|${cleanPage}|${short}`) ??
    book.byPageTitle.get(`${other}|${cleanPage}|${short}`) ??
    null
  )
}
