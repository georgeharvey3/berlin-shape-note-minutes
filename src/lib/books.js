// The songs of one book, and the link between its editions.
//
// A book has one or two editions. The Shenandoah Harmony has one. The Sacred
// Harp has two: the singers changed the edition in September 2025. The 1991
// edition has 554 songs on pages 26 to 573. The 2025 edition has 590 songs on
// pages 26 to 575. The 2025 edition adds songs, removes songs, and moves a few
// songs to a new page: "Africa" moves from 178 to 178t.
//
// A song must stay one song across the two editions, so this module builds a
// crosswalk. Each song gets one `id`, and it keeps the page and the title of
// each edition it belongs to. The dashboard counts the calls of the two
// editions together under that one id.

// Curly and straight apostrophes must match each other: the 1991 sheet writes
// a straight apostrophe in "O'Leary" and the 2025 sheet writes a curly one.
export function foldTitle(value) {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ROMAN_DIGITS = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

// The value of a roman page number, or null. The front matter of the
// Shenandoah Harmony carries "When Jesus Wept" on page viii.
function romanValue(page) {
  if (!/^[ivxlcdm]+$/i.test(page)) return null
  const digits = [...page.toLowerCase()].map((char) => ROMAN_DIGITS[char])
  let total = 0
  for (let i = 0; i < digits.length; i += 1) {
    total += digits[i] < digits[i + 1] ? -digits[i] : digits[i]
  }
  return total
}

// "48b" sorts after "48t" the way the book runs: page number, then t before b.
// A roman page belongs to the front matter, so it sorts before page 1.
export function pageOrder(page) {
  const text = page.trim()
  const match = /^(\d+)\s*([tb]?)$/.exec(text)
  if (match) {
    const [, number, half] = match
    return Number(number) * 10 + (half === 'b' ? 1 : 0)
  }
  const roman = romanValue(text)
  if (roman !== null) return roman - 10000
  return Number.MAX_SAFE_INTEGER
}

export function pageNumber(page) {
  const match = /^(\d+)/.exec(page.trim())
  return match ? Number(match[1]) : null
}

// Read one "Song Frequency" sheet. It lists every song of one edition.
// The sheet of the Shenandoah Harmony also names the source book and the mode
// of each song. The sheets of the Sacred Harp do not, so both stay optional.
export function readBookIndex(rawRows) {
  return rawRows
    .map((row) => ({
      page: (row.Page ?? '').trim(),
      title: (row.Title ?? '').trim(),
      source: (row['Source Abbr.'] ?? '').trim(),
      mode: (row.Mode ?? '').trim(),
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
 *  1. Same page and same title. This matches 457 of the 554 songs of 1991.
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

// Rows of a "Song Frequency" sheet that the edition does not have. The music
// of the 1991 Sacred Harp starts on page 26, so its pages 24t, 24b and 25 hold
// no song. That edition has 554 songs, and these three rows make it 557.
function dropExcluded(edition, index) {
  const excluded = new Set(edition.excludedPages ?? [])
  return index.filter((song) => !excluded.has(song.page))
}

function songId(editionId, song) {
  return `${editionId}:${song.page}|${song.fold}`
}

/**
 * Build the song list of one book from its edition sheets.
 *
 * `definition` is the book from `sheets.js`. `indexes` holds one read index
 * per edition id. Every song gets one entry with the page and the title of
 * each edition it belongs to. In a book with two editions, a song that only
 * the older edition has keeps the status "removed", and a song that only the
 * newer edition has keeps the status "added".
 */
export function buildBook(definition, indexes) {
  const editionIds = definition.editions.map((edition) => edition.id)
  if (editionIds.length > 2) {
    throw new Error('The crosswalk joins two editions, so a book cannot have more than two.')
  }
  const currentEdition = editionIds[editionIds.length - 1]
  const cleaned = definition.editions.map((edition) =>
    dropExcluded(edition, indexes[edition.id] ?? []),
  )
  const songs = []

  function push(id, editions, status) {
    const current = editions[currentEdition] ?? editions[editionIds[0]]
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

  if (editionIds.length === 1) {
    const [only] = editionIds
    for (const song of cleaned[0]) push(songId(only, song), { [only]: song }, 'both')
  } else {
    const [older, newer] = editionIds
    const { pairs, removed, added } = crosswalk(cleaned[0], cleaned[1])
    for (const [oldSong, newSong] of pairs) {
      push(songId(newer, newSong), { [older]: oldSong, [newer]: newSong }, 'both')
    }
    for (const song of added) push(songId(newer, song), { [older]: null, [newer]: song }, 'added')
    for (const song of removed) push(songId(older, song), { [older]: song, [newer]: null }, 'removed')
  }

  songs.sort((a, b) => a.bookOrder - b.bookOrder)

  // The lookup tables, one per edition: by page and title, and by title alone.
  const byPageTitle = new Map()
  const byTitle = new Map()
  for (const song of songs) {
    for (const editionId of editionIds) {
      const inEdition = song.editions[editionId]
      if (!inEdition) continue
      byPageTitle.set(`${editionId}|${inEdition.page}|${inEdition.fold}`, song)
      const titleKey = `${editionId}|${inEdition.fold}`
      const found = byTitle.get(titleKey)
      byTitle.set(titleKey, found === undefined ? song : null)
    }
  }

  return { definition, editionIds, currentEdition, songs, byPageTitle, byTitle }
}

/**
 * Find the song of one minute row.
 *
 * `edition` is the edition the singers used on that day. The search widens
 * step by step, because a sheet holds a few typed pages that no edition has,
 * such as "???" for "Mear" and "Xxx" for a carol that is not in the book. Each
 * pass tries the edition of the day first and then every other edition.
 */
export function findSong(book, edition, page, title) {
  const fold = foldTitle(title)
  const cleanPage = page.trim()
  // A sheet also holds a title with a note in brackets at the end, such as
  // "My Home (First) (red book)". The last pass drops that note.
  const short = foldTitle(title.replace(/\s*\([^()]*\)\s*$/, ''))
  const order = [edition, ...book.editionIds.filter((id) => id !== edition)]
  const passes = [
    (id) => book.byPageTitle.get(`${id}|${cleanPage}|${fold}`),
    (id) => book.byTitle.get(`${id}|${fold}`),
    (id) => book.byPageTitle.get(`${id}|${cleanPage}|${short}`),
  ]
  for (const pass of passes) {
    for (const id of order) {
      const found = pass(id)
      if (found) return found
    }
  }
  return null
}
