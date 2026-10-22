/**
 * The send of the minutes, from the app to the two minutes spreadsheets.
 *
 * This is a standalone Apps Script. It opens both spreadsheets by ID and runs
 * as the account that deployed it. The README of the app says how to deploy
 * it and how to set the password.
 *
 * The year sheets are pre-filled: every row already carries its "Order of
 * entry" and the formula of its "Song Title". So the script does not append
 * rows at the bottom. It fills the first rows after the last call, and it
 * writes the event, the date, the leader, the page and the notes only.
 */

const SPREADSHEETS = {
  'sacred-harp': '1lM9ijnQKsV0GdaZcOe3bbDtIWXlk4RoFEfDc7Xn48Sc',
  shenandoah: '1V3Z_OYA3hxPvri0PbKSbl5czhBOIV7tNb1qMUsazhdo',
}

const BOOK_NAMES = {
  'sacred-harp': 'Sacred Harp',
  shenandoah: 'Shenandoah Harmony',
}

// The headers of the minutes sheets, matched on a prefix. The Sacred Harp
// sheet writes "Name(s) of Leaders" and the Shenandoah sheet writes "Name(s)".
const COLUMNS = {
  order: 'Order of entry',
  event: 'Event',
  date: 'Date',
  leaders: 'Name(s)',
  page: 'Page',
  notes: 'Notes',
}

function doGet() {
  return reply({ ok: true, message: 'The minutes script is running.' })
}

function doPost(e) {
  let body
  try {
    body = JSON.parse(e.postData.contents)
  } catch (error) {
    return reply({ ok: false, reason: 'error', message: 'The request is not JSON.' })
  }

  const password = PropertiesService.getScriptProperties().getProperty('PASSWORD')
  if (!password) {
    return reply({
      ok: false,
      reason: 'not-set-up',
      message: 'The script has no PASSWORD in its script properties.',
    })
  }
  if (body.password !== password) {
    return reply({ ok: false, reason: 'password', message: 'Wrong password.' })
  }

  const problem = checkBody(body)
  if (problem) return reply({ ok: false, reason: 'error', message: problem })

  // Two sends at the same time must not fill the same rows.
  const lock = LockService.getScriptLock()
  lock.waitLock(30000)
  try {
    return reply(send(body))
  } catch (error) {
    return reply({ ok: false, reason: 'error', message: String(error && error.message) })
  } finally {
    lock.releaseLock()
  }
}

function checkBody(body) {
  if (typeof body.event !== 'string' || body.event.trim() === '') return 'The event is missing.'
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(body.date || '')) return 'The date must be dd.mm.yyyy.'
  if (!Number.isInteger(body.year)) return 'The year is missing.'
  if (!body.books || typeof body.books !== 'object') return 'The calls are missing.'
  for (const bookId of Object.keys(body.books)) {
    if (!SPREADSHEETS[bookId]) return 'Unknown book: ' + bookId
    if (!Array.isArray(body.books[bookId])) return 'The calls of ' + bookId + ' are not a list.'
  }
  return null
}

function send(body) {
  const targets = []
  for (const bookId of Object.keys(body.books)) {
    const calls = body.books[bookId]
    if (calls.length === 0) continue
    const name = 'Minutes ' + body.year
    const sheet = SpreadsheetApp.openById(SPREADSHEETS[bookId]).getSheetByName(name)
    if (!sheet) {
      return {
        ok: false,
        reason: 'no-sheet',
        message:
          'The ' + BOOK_NAMES[bookId] + ' spreadsheet has no sheet "' + name + '". ' +
          'Ask the sheet owner to make it, then send again.',
      }
    }
    const values = sheet.getDataRange().getDisplayValues()
    const columns = findColumns(values[0] || [])
    const missing = Object.keys(COLUMNS).filter((key) => key !== 'order' && columns[key] < 0)
    if (missing.length > 0) {
      return {
        ok: false,
        reason: 'error',
        message: 'The sheet "' + name + '" of the ' + BOOK_NAMES[bookId] +
          ' has no column for: ' + missing.join(', '),
      }
    }
    targets.push({ bookId, sheet, values, columns, calls })
  }

  // The same singing already in the sheet: a backup typed by hand, or a
  // second send. The app asks the minutes taker before it adds the calls.
  const existing = {}
  let found = 0
  for (const target of targets) {
    const count = countSinging(target, body.event, body.date)
    existing[target.bookId] = count
    found += count
  }
  if (found > 0 && !body.force) return { ok: false, reason: 'exists', existing }

  const written = {}
  for (const target of targets) {
    written[target.bookId] = writeCalls(target, body.event, body.date)
  }
  SpreadsheetApp.flush()
  return { ok: true, written }
}

function findColumns(header) {
  const columns = {}
  for (const key of Object.keys(COLUMNS)) {
    columns[key] = header.findIndex((cell) => String(cell).trim().indexOf(COLUMNS[key]) === 0)
  }
  return columns
}

// "25.09.2026" and "9/25/2026" name the same day. The sheets up to 2025 hold
// US dates.
function sameDay(cell, date) {
  const text = String(cell).trim()
  if (text === date) return true
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (!us) return false
  const [day, month, year] = date.split('.').map(Number)
  return Number(us[1]) === month && Number(us[2]) === day && Number(us[3]) === year
}

function countSinging(target, event, date) {
  const { values, columns } = target
  let count = 0
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i]
    if (String(row[columns.event]).trim() === event.trim() && sameDay(row[columns.date], date)) {
      count += 1
    }
  }
  return count
}

// A row holds a call when it has a date, a leader or a page.
function lastCallRow(target) {
  const { values, columns } = target
  for (let i = values.length - 1; i >= 1; i -= 1) {
    const row = values[i]
    if ([columns.date, columns.leaders, columns.page].some((c) => String(row[c]).trim() !== '')) {
      return i + 1
    }
  }
  return 1
}

function writeCalls(target, event, date) {
  const { sheet, columns, calls } = target
  const start = lastCallRow(target) + 1
  const end = start + calls.length - 1
  extendRows(sheet, end, columns)

  setColumn(sheet, start, columns.event, calls.length, calls.map(() => safe(event)))
  const [day, month, year] = date.split('.').map(Number)
  const dateRange = sheet.getRange(start, columns.date + 1, calls.length, 1)
  dateRange.setValues(calls.map(() => [new Date(year, month - 1, day)]))
  dateRange.setNumberFormat('dd.mm.yyyy')
  setColumn(sheet, start, columns.leaders, calls.length, calls.map((call) => safe(call.leader)))
  setColumn(sheet, start, columns.page, calls.length, calls.map((call) => safe(call.page)))
  setColumn(sheet, start, columns.notes, calls.length, calls.map((call) => safe(call.notes || '')))
  return calls.length
}

// The pre-filled rows can run out late in a year. Then the script copies the
// last row down, so the new rows get the formula of the title too, and it
// numbers the order on from the last row.
function extendRows(sheet, end, columns) {
  const lastRow = sheet.getLastRow()
  if (end <= lastRow) return
  if (end > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), end - sheet.getMaxRows())
  const width = sheet.getLastColumn()
  const template = sheet.getRange(lastRow, 1, 1, width)
  template.copyTo(sheet.getRange(lastRow + 1, 1, end - lastRow, width))
  if (columns.order < 0) return
  const orderCell = sheet.getRange(lastRow, columns.order + 1)
  if (orderCell.getFormula() !== '') return
  const last = Number(orderCell.getValue())
  if (!Number.isFinite(last)) return
  const numbers = []
  for (let row = lastRow + 1; row <= end; row += 1) numbers.push([last + (row - lastRow)])
  sheet.getRange(lastRow + 1, columns.order + 1, end - lastRow, 1).setValues(numbers)
}

function setColumn(sheet, start, column, count, values) {
  sheet.getRange(start, column + 1, count, 1).setValues(values.map((value) => [value]))
}

// A cell that starts with "=", "+" or "@" becomes a formula. A leader name
// never needs that, so the script writes such a value as text.
function safe(value) {
  const text = String(value)
  return /^[=+@]/.test(text) ? "'" + text : text
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
