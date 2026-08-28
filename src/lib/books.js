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
//
// The book gives the list of the songs that changed their page or their title.
// `changes` on the newer edition, in `sheets.js`, holds that list. The list is
// complete, so a song that the list does not name keeps its page and its
// title. Two songs with the same title on two different pages are therefore
// two songs, and not one song that moved.

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

// A title without the note in brackets at the end. The 1991 edition writes
// "My Home (First)" and the 2025 edition drops the "(First)" and "(Second)"
// notes. A sheet of minutes also adds a note of its own, such as
// "My Home (First) (red book)".
export function shortFold(title) {
  return foldTitle(title.replace(/\s*\([^()]*\)\s*$/, ''))
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
      short: shortFold(song.title),
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

// True when one title is the other title with a whole word more. The 2025
// edition names a different tune with such a word: "Imandra" on 45b and
// "Imandra New" on 525 are two songs, and so are "Wells" and "Wells Second".
// A pair like this is therefore never a new spelling of one title.
function addsAWord(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return long.startsWith(`${short} `) || long.endsWith(` ${short}`)
}

/**
 * Build the crosswalk between the two editions.
 *
 * `changes` is the list of the songs that changed their page or their title.
 * It comes from the book, and it is complete.
 *
 * The match runs in four passes. Each pass takes only the songs that no
 * earlier pass matched:
 *
 *  1. The change list. It names the page of each edition and the new title,
 *     so it matches "Africa" on 178 to "Africa" on 178t, and "Southwell" on
 *     365 to "Southwell" on 364. This pass matches 17 songs.
 *  2. Same page and same title. This pass matches 457 songs.
 *  3. Same page, and the same title after the note in brackets goes out. This
 *     catches the removal of a "(First)" or "(Second)" note. The sheets of
 *     today give this pass no song, but a later edit of a sheet can.
 *  4. Same page number and a similar title. This catches a new spelling, such
 *     as "Carmathen" to "Carmarthen" on page 473. A title with a whole word
 *     more names another song, so this pass leaves such a pair alone. This
 *     pass matches 3 songs.
 *
 * The result is 477 of the 554 songs of the 1991 edition.
 */
function crosswalk(oldIndex, newIndex, changes = []) {
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

  // The change list keys on the page of the older edition. A change that the
  // sheets no longer carry finds no song, and the later passes take over.
  const moves = new Map(changes.map((change) => [change.from, change]))
  pass((song, rest) => {
    const change = moves.get(song.page)
    if (!change) return null
    const wanted = foldTitle(change.title)
    return rest.find((other) => other.page === change.to && other.fold === wanted) ?? null
  })
  pass((song, rest) =>
    rest.find((other) => other.page === song.page && other.fold === song.fold),
  )
  pass((song, rest) =>
    rest.find((other) => other.page === song.page && other.short === song.short),
  )
  pass((song, rest) => {
    let best = null
    let score = 0
    for (const other of rest) {
      if (other.number !== song.number) continue
      if (addsAWord(song.fold, other.fold)) continue
      const value = titleSimilarity(song.fold, other.fold)
      if (value > score) {
        score = value
        best = other
      }
    }
    return score >= 0.78 ? best : null
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
    const changes = definition.editions[1].changes ?? []
    const { pairs, removed, added } = crosswalk(cleaned[0], cleaned[1], changes)
    for (const [oldSong, newSong] of pairs) {
      push(songId(newer, newSong), { [older]: oldSong, [newer]: newSong }, 'both')
    }
    for (const song of added) push(songId(newer, song), { [older]: null, [newer]: song }, 'added')
    for (const song of removed) push(songId(older, song), { [older]: song, [newer]: null }, 'removed')
  }

  songs.sort((a, b) => a.bookOrder - b.bookOrder)

  // The lookup tables, one per edition: by page and title, and by title alone.
  // A title with a note in brackets, such as "My Home (First)", goes in twice.
  // The newer edition drops such a note, so a call can name the song either
  // way. A title that two songs of one edition carry gives no answer, so
  // `byTitle` holds null for it.
  const byPageTitle = new Map()
  const byTitle = new Map()
  for (const song of songs) {
    for (const editionId of editionIds) {
      const inEdition = song.editions[editionId]
      if (!inEdition) continue
      const folds = new Set([inEdition.fold, inEdition.short])
      for (const fold of folds) {
        const pageKey = `${editionId}|${inEdition.page}|${fold}`
        if (!byPageTitle.has(pageKey)) byPageTitle.set(pageKey, song)
        const titleKey = `${editionId}|${fold}`
        const found = byTitle.get(titleKey)
        byTitle.set(titleKey, found === undefined || found === song ? song : null)
      }
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
  const short = shortFold(title)
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
