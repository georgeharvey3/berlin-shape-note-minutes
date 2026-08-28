// The two books the Berlin singers sing from, the Google Sheet behind each
// book, and the download of one sheet as CSV.
//
// The CSV export URL answers with "access-control-allow-origin: *", so the
// browser can read it. A sheet must stay readable by "Anyone with the link".
// The sync script uses the same code to write the snapshot files.
import { parseCsv } from './csv.js'

// One entry per book. `minutes` holds one sheet per year. `editions` holds one
// "Song Frequency" sheet per edition, from the oldest edition to the newest.
// Each sheet lists every song of one edition, so it gives the songs that
// nobody called. The dashboard counts the calls itself, so it reads the page
// and the title only, and not the "Frequency" column.
const BOOK_DEFINITIONS = [
  {
    id: 'sacred-harp',
    label: 'Sacred Harp',
    title: 'Berlin Sacred Harp',
    bookName: 'The Sacred Harp',
    offBookLabel: 'not in either edition',
    searchHint: 'e.g. Windham, 38b, Mara',
    spreadsheetId: '1lM9ijnQKsV0GdaZcOe3bbDtIWXlk4RoFEfDc7Xn48Sc',
    minutes: [
      { gid: '258489324', sheetName: 'Minutes 2021', file: 'minutes-2021.json', year: 2021 },
      { gid: '604639145', sheetName: 'Minutes 2022', file: 'minutes-2022.json', year: 2022 },
      { gid: '1637353649', sheetName: 'Minutes 2023', file: 'minutes-2023.json', year: 2023 },
      { gid: '1395348588', sheetName: 'Minutes 2024', file: 'minutes-2024.json', year: 2024 },
      { gid: '445980238', sheetName: 'Minutes 2025', file: 'minutes-2025.json', year: 2025 },
      { gid: '1924038192', sheetName: 'Minutes 2026', file: 'minutes-2026.json', year: 2026 },
    ],
    // The singers changed the edition in September 2025.
    editions: [
      {
        id: '1991',
        label: '1991 edition',
        gid: '588178310',
        sheetName: 'Song Frequency 1991 (year 2025)',
        file: 'book-1991.json',
        // The music of the 1991 edition starts on page 26, so these three rows
        // of the sheet hold no song.
        excludedPages: ['24t', '24b', '25'],
      },
      {
        id: '2025',
        label: '2025 edition',
        gid: '954249996',
        sheetName: 'Song Frequency 2026',
        file: 'book-2025.json',
        // Every song that changed its page or its title in the 2025 edition.
        // The list is complete: a song that it does not name keeps the page
        // and the title of the 1991 edition. `from` is the page of the 1991
        // edition. `to` and `title` are the page and the title of the 2025
        // edition. `src/lib/books.js` matches the two editions with this list.
        changes: [
          // A song on a new page.
          { from: '330b', to: '330t', title: 'Fellowship' },
          { from: '365', to: '364', title: 'Southwell' },
          { from: '507', to: '508', title: 'Sermon on the Mount' },
          { from: '566', to: '565t', title: 'Hebron' },
          // A page that the 2025 edition cuts into a top half and a bottom
          // half. The song keeps the number and takes a "t" or a "b".
          { from: '27', to: '27t', title: 'Bethel' },
          { from: '178', to: '178t', title: 'Africa' },
          { from: '347', to: '347t', title: 'Christian’s Farewell' },
          { from: '414', to: '414b', title: 'Parting Friend' },
          { from: '420', to: '420b', title: 'Bishop' },
          { from: '423', to: '423t', title: 'Grantville' },
          { from: '452', to: '452b', title: 'Martin' },
          { from: '497', to: '497t', title: 'Natick' },
          { from: '499', to: '499b', title: 'At Rest' },
          { from: '501', to: '501b', title: 'O’Leary' },
          { from: '565', to: '565b', title: 'The Hill of Zion' },
          // A song with the original title again.
          { from: '227', to: '227', title: 'Ode of Life’s Journey' },
          { from: '143', to: '143', title: 'Pleyel’s Hymn Second' },
        ],
      },
    ],
  },
  {
    id: 'shenandoah',
    label: 'Shenandoah Harmony',
    title: 'Berlin Shenandoah Harmony',
    bookName: 'The Shenandoah Harmony',
    offBookLabel: 'not in the book',
    searchHint: 'e.g. Stroudwater, 12b, Caro',
    spreadsheetId: '1V3Z_OYA3hxPvri0PbKSbl5czhBOIV7tNb1qMUsazhdo',
    minutes: [
      { gid: '1883806332', sheetName: 'Minutes 2021', file: 'minutes-2021.json', year: 2021 },
      { gid: '422137562', sheetName: 'Minutes 2022', file: 'minutes-2022.json', year: 2022 },
      { gid: '1289395992', sheetName: 'Minutes 2023', file: 'minutes-2023.json', year: 2023 },
      { gid: '1422186979', sheetName: 'Minutes 2024', file: 'minutes-2024.json', year: 2024 },
      { gid: '867681210', sheetName: 'Minutes 2025', file: 'minutes-2025.json', year: 2025 },
      { gid: '245867035', sheetName: 'Minutes 2026', file: 'minutes-2026.json', year: 2026 },
    ],
    // The book has one edition, so the dashboard shows no edition filter.
    editions: [
      {
        id: 'shenandoah',
        label: 'The Shenandoah Harmony',
        gid: '1535479059',
        sheetName: 'Song Frequency',
        file: 'book-shenandoah.json',
      },
    ],
  },
]

// The book owns the spreadsheet, so every sheet of a book carries the same ID.
// The `key` and the `file` carry the book, because the two books have a sheet
// with the same name for each year.
function stamp(book, sheet, kind) {
  return {
    ...sheet,
    kind,
    bookId: book.id,
    spreadsheetId: book.spreadsheetId,
    key: `${book.id}/${sheet.file}`,
    file: `${book.id}/${sheet.file}`,
  }
}

export const BOOKS = BOOK_DEFINITIONS.map((book) => ({
  ...book,
  url: sheetUrl({ spreadsheetId: book.spreadsheetId, gid: book.minutes[0].gid }),
  minutes: book.minutes.map((sheet) => stamp(book, sheet, 'minutes')),
  editions: book.editions.map((edition) => stamp(book, edition, 'edition')),
}))

export const SHEETS = BOOKS.flatMap((book) => [...book.minutes, ...book.editions])

export function csvUrl(sheet) {
  return `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/export?format=csv&gid=${sheet.gid}`
}

export function sheetUrl(sheet) {
  return `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit?gid=${sheet.gid}`
}

// Download one sheet and give back the same shape as the snapshot files.
// It throws if the sheet is not public: Google then sends an HTML sign-in page.
//
// The rows are arrays and the column names sit in `columns`. The dashboard
// bundles a snapshot of every sheet, so this shape keeps the bundle small.
export async function fetchSheet(sheet, options = {}) {
  const response = await fetch(csvUrl(sheet), {
    redirect: 'follow',
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(
      `Download of "${sheet.sheetName}" failed: ${response.status} ${response.statusText}`,
    )
  }

  const csv = await response.text()
  if (csv.trimStart().startsWith('<')) {
    throw new Error('Google sent an HTML page, not CSV. The sheet is probably not public.')
  }

  const table = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ''))
  const columns = (table[0] ?? []).map((cell) => cell.trim())
  const rows = table.slice(1).map((cells) => columns.map((_, index) => (cells[index] ?? '').trim()))

  return {
    source: {
      spreadsheetId: sheet.spreadsheetId,
      gid: sheet.gid,
      sheetName: sheet.sheetName,
      url: sheetUrl(sheet),
    },
    fetchedAt: new Date().toISOString(),
    columns,
    rowCount: rows.length,
    rows,
  }
}

// Turn the array rows of a snapshot back into objects, one key per column.
// A column with an empty name carries no data that the dashboard needs, so
// this reader drops it. The "Minutes 2021" sheet has two such columns.
export function toObjects(snapshot) {
  const columns = snapshot.columns ?? []
  return snapshot.rows.map((cells) => {
    const row = {}
    columns.forEach((name, index) => {
      if (name !== '') row[name] = cells[index] ?? ''
    })
    return row
  })
}
