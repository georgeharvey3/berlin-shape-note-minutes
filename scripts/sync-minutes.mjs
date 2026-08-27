#!/usr/bin/env node
// Download the two sheets and store them as JSON snapshots.
// The dashboard reads the sheets live, so these files are the fallback for a
// browser that gets no answer from Google. Run it with: npm run sync
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SHEETS, fetchSheet } from '../src/lib/sheets.js'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')

for (const sheet of Object.values(SHEETS)) {
  let snapshot
  try {
    snapshot = await fetchSheet(sheet)
  } catch (error) {
    console.error(error.message)
    console.error('Make sure the sheet is readable by "Anyone with the link".')
    process.exit(1)
  }

  const outputFile = path.join(dataDir, sheet.file)
  await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(
    `Wrote ${snapshot.rowCount} rows of "${sheet.sheetName}" to ${path.relative(process.cwd(), outputFile)}`,
  )
}
