#!/usr/bin/env node
// Download the "Minutes 2026" sheet and store it as a JSON snapshot.
// Run it with: npm run sync
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseCsvToObjects } from '../src/lib/csv.js'

const SPREADSHEET_ID = '1lM9ijnQKsV0GdaZcOe3bbDtIWXlk4RoFEfDc7Xn48Sc'

// The two sheets the dashboard needs. "Song Frequency 2026" holds every song in
// the book, so it gives the songs that nobody called.
const SHEETS = [
  { gid: '1924038192', sheetName: 'Minutes 2026', file: 'minutes-2026.json' },
  { gid: '954249996', sheetName: 'Song Frequency 2026', file: 'song-index.json' },
]

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')

for (const sheet of SHEETS) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${sheet.gid}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    console.error(`Download of "${sheet.sheetName}" failed: ${response.status} ${response.statusText}`)
    console.error('Make sure the sheet is readable by "Anyone with the link".')
    process.exit(1)
  }

  const csv = await response.text()
  if (csv.trimStart().startsWith('<')) {
    console.error('Google sent an HTML page, not CSV. The sheet is probably not public.')
    process.exit(1)
  }

  const rows = parseCsvToObjects(csv)
  const snapshot = {
    source: {
      spreadsheetId: SPREADSHEET_ID,
      gid: sheet.gid,
      sheetName: sheet.sheetName,
      url: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${sheet.gid}`,
    },
    fetchedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  }

  const outputFile = path.join(dataDir, sheet.file)
  await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`Wrote ${rows.length} rows of "${sheet.sheetName}" to ${path.relative(process.cwd(), outputFile)}`)
}
