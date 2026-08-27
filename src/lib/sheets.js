// The Google Sheet behind the dashboard, and the download of one sheet as CSV.
//
// The CSV export URL answers with "access-control-allow-origin: *", so the
// browser can read it. The sheet must stay readable by "Anyone with the link".
// The sync script uses the same code to write the snapshot files.
import { parseCsvToObjects } from './csv.js'

export const SPREADSHEET_ID = '1lM9ijnQKsV0GdaZcOe3bbDtIWXlk4RoFEfDc7Xn48Sc'

// The two sheets the dashboard needs. "Song Frequency 2026" holds every song in
// the book, so it gives the songs that nobody called.
export const SHEETS = {
  minutes: { gid: '1924038192', sheetName: 'Minutes 2026', file: 'minutes-2026.json' },
  songIndex: { gid: '954249996', sheetName: 'Song Frequency 2026', file: 'song-index.json' },
}

export function csvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`
}

export function sheetUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${gid}`
}

// Download one sheet and give back the same shape as the snapshot files.
// It throws if the sheet is not public: Google then sends an HTML sign-in page.
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

  const rows = parseCsvToObjects(csv)
  return {
    source: {
      spreadsheetId: SPREADSHEET_ID,
      gid: sheet.gid,
      sheetName: sheet.sheetName,
      url: sheetUrl(sheet.gid),
    },
    fetchedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  }
}
