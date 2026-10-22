// The send of the draft minutes to the sheets.
//
// The browser cannot write to a Google Sheet on its own: the Sheets API needs
// a Google sign-in to write, even when "Anyone with the link" can edit. A
// standalone Apps Script, `apps-script/Code.gs`, writes the rows for the app.
// It runs as the account that deployed it.
//
// The request body is plain text, so the browser sends a simple request with
// no preflight. The script answers through a redirect that allows any origin.

import { callsByBook, germanDate } from './draft.js'

// The URL of the deployed web app. It ends in "/exec". Empty means that
// nobody deployed the script yet, and the app says so.
export const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbw_gUC2Akv1CegHtpUPnPFmAmKdCIV8a52-qzqDlzwyU59hQHRlsp-9iNfFamNFs58y/exec'

/**
 * Send the draft. The answer is one of:
 *
 *  - `{ ok: true, written: { [book id]: count } }`
 *  - `{ ok: false, reason: 'password' }`
 *  - `{ ok: false, reason: 'exists', existing: { [book id]: count } }`
 *  - `{ ok: false, reason: 'no-sheet' | 'not-set-up' | 'error', message }`
 *
 * `force` sends although the sheet already holds calls of this singing.
 */
export async function sendMinutes(draft, password, { force = false } = {}) {
  if (!SCRIPT_URL) {
    return {
      ok: false,
      reason: 'not-set-up',
      message: 'Nobody has set up the send yet. The README says how.',
    }
  }
  const body = {
    password,
    force,
    event: draft.event,
    date: germanDate(draft.date),
    year: Number(draft.date.slice(0, 4)),
    books: callsByBook(draft),
  }
  let response
  try {
    response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) })
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: 'The script did not answer. Check the connection and send again.',
    }
  }
  try {
    return await response.json()
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: `The script sent an answer the app cannot read (${response.status}).`,
    }
  }
}
