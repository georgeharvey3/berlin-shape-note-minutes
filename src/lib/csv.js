// Minimal RFC 4180 CSV parser: handles quoted fields, embedded commas,
// escaped double quotes and CRLF line endings.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

export function parseCsvToObjects(text) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ''))
  if (rows.length === 0) return []
  const header = rows[0].map((cell) => cell.trim())
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((key, index) => [key, (cells[index] ?? '').trim()])),
  )
}
