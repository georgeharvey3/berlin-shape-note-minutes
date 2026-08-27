// The Google Sheet behind the dashboard, and the download of one sheet as CSV.
//
// The CSV export URL answers with "access-control-allow-origin: *", so the
// browser can read it. The sheet must stay readable by "Anyone with the link".
// The sync script uses the same code to write the snapshot files.
import { parseCsv } from './csv.js'

export const SPREADSHEET_ID = '1lM9ijnQKsV0GdaZcOe3bbDtIWXlk4RoFEfDc7Xn48Sc'

// One sheet of minutes per year. The sheet holds the year in its name, and the
// rows carry the date, so `year` here is only the label and the fallback.
export const MINUTES_SHEETS = [
  { key: 'minutes2021', gid: '258489324', sheetName: 'Minutes 2021', file: 'minutes-2021.json', year: 2021 },
  { key: 'minutes2022', gid: '604639145', sheetName: 'Minutes 2022', file: 'minutes-2022.json', year: 2022 },
  { key: 'minutes2023', gid: '1637353649', sheetName: 'Minutes 2023', file: 'minutes-2023.json', year: 2023 },
  { key: 'minutes2024', gid: '1395348588', sheetName: 'Minutes 2024', file: 'minutes-2024.json', year: 2024 },
  { key: 'minutes2025', gid: '445980238', sheetName: 'Minutes 2025', file: 'minutes-2025.json', year: 2025 },
  { key: 'minutes2026', gid: '1924038192', sheetName: 'Minutes 2026', file: 'minutes-2026.json', year: 2026 },
]

// The two editions of the book. The singers changed the edition in September
// 2025.
// Each sheet lists every song of one edition, so it gives the songs that
// nobody called. The dashboard counts the calls itself, so it reads the page
// and the title only, and not the "Frequency" column.
export const BOOK_SHEETS = [
  {
    key: 'book1991',
    gid: '588178310',
    sheetName: 'Song Frequency 1991 (year 2025)',
    file: 'book-1991.json',
    edition: '1991',
  },
  {
    key: 'book2025',
    gid: '954249996',
    sheetName: 'Song Frequency 2026',
    file: 'book-2025.json',
    edition: '2025',
  },
]

export const SHEETS = [...MINUTES_SHEETS, ...BOOK_SHEETS]

export function csvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`
}

export function sheetUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${gid}`
}

// Download one sheet and give back the same shape as the snapshot files.
// It throws if the sheet is not public: Google then sends an HTML sign-in page.
//
// The rows are arrays and the column names sit in `columns`. The dashboard
// bundles eight snapshots, so this shape keeps the bundle small.
export async function fetchSheet(sheet, options = {}) {
  const response = await fetch(csvUrl(sheet.gid), {
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
      spreadsheetId: SPREADSHEET_ID,
      gid: sheet.gid,
      sheetName: sheet.sheetName,
      url: sheetUrl(sheet.gid),
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
