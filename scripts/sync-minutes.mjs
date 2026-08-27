#!/usr/bin/env node
// Download every sheet of every book and store it as a JSON snapshot.
// The dashboard reads the sheets live, so these files are the fallback for a
// browser that gets no answer from Google. Run it with: npm run sync
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SHEETS, fetchSheet } from '../src/lib/sheets.js'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')

for (const sheet of SHEETS) {
  let snapshot
  try {
    snapshot = await fetchSheet(sheet)
  } catch (error) {
    console.error(error.message)
    console.error('Make sure the sheet is readable by "Anyone with the link".')
    process.exit(1)
  }

  // The `file` of a sheet carries its book, so each book gets its own folder.
  const outputFile = path.join(dataDir, sheet.file)
  await mkdir(path.dirname(outputFile), { recursive: true })
  // The bundle holds a snapshot of every sheet, so write them without
  // indentation.
  await writeFile(outputFile, `${JSON.stringify(snapshot)}\n`)
  console.log(
    `Wrote ${snapshot.rowCount} rows of "${sheet.sheetName}" to ${path.relative(process.cwd(), outputFile)}`,
  )
}
