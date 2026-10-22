import { useMemo, useRef, useState } from 'react'
import { BOOKS, toObjects } from './lib/sheets.js'
import { buildBook, readBookIndex } from './lib/books.js'
import { cleanAllRows } from './lib/minutes.js'
import {
  currentSongs,
  formatHandover,
  formatPost,
  germanDate,
  lastEvent,
  leaderHistory,
  leaderLabel,
  leaderSuggestions,
  newDraft,
  newId,
  parseHandover,
  savedPassword,
  songChoices,
  todayIso,
} from './lib/draft.js'
import { sendMinutes } from './lib/sendMinutes.js'

// The most leader buttons the form shows: the leaders of this singing first,
// then the regulars of the last eight weeks.
const LEADER_BUTTONS = 18

function bookLabel(bookId) {
  return BOOKS.find((book) => book.id === bookId)?.label ?? bookId
}

function otherBook(bookId) {
  return BOOKS.find((book) => book.id !== bookId)?.id ?? bookId
}

/**
 * The screen of the minutes taker, at `#minutes`.
 *
 * `live` is the shared read of the sheets. It gives the songs of each book
 * and the leaders and events of the past minutes. `draft` and `setDraft`
 * come from `useDraft`, which App owns, so the bar "Minutes in progress" and
 * this screen show the same draft.
 */
export default function MinutesTaker({ live, draft, setDraft }) {
  const { snapshots } = live

  // The songs of the edition each book uses now, by page.
  const lookups = useMemo(() => {
    const result = {}
    for (const definition of BOOKS) {
      const book = buildBook(
        definition,
        Object.fromEntries(
          definition.editions.map((edition) => [
            edition.id,
            readBookIndex(toObjects(snapshots[edition.key])),
          ]),
        ),
      )
      result[definition.id] = currentSongs(book)
    }
    return result
  }, [snapshots])

  const history = useMemo(() => {
    const calls = BOOKS.flatMap(
      (definition) =>
        cleanAllRows(
          definition.minutes.map((sheet) => ({ sheet, rows: toObjects(snapshots[sheet.key]) })),
        ).calls,
    )
    return leaderHistory(calls)
  }, [snapshots])

  return (
    <section className="minutes" aria-label="Take minutes">
      <p className="minutes-back">
        <a href="#">Back to the dashboard</a>
      </p>
      {!draft && <StartSinging history={history} setDraft={setDraft} lookups={lookups} />}
      {draft && draft.status === 'recording' && (
        <Recorder
          draft={draft}
          setDraft={setDraft}
          lookups={lookups}
          history={history}
          onSent={live.refresh}
        />
      )}
      {draft && draft.status === 'sent' && (
        <SentSummary draft={draft} setDraft={setDraft} lookups={lookups} />
      )}
    </section>
  )
}

function StartSinging({ history, setDraft, lookups }) {
  const [event, setEvent] = useState(() => lastEvent.get() ?? history.events[0] ?? '')
  const [date, setDate] = useState(todayIso)
  const ready = event.trim() !== '' && date !== ''

  function start(bookId) {
    lastEvent.set(event.trim())
    setDraft(newDraft({ event: event.trim(), date, bookId }))
  }

  return (
    <>
      <h2 className="minutes-title">New singing</h2>
      <div className="minutes-fields">
        <label className="field">
          <span className="field-label">Event</span>
          <input
            type="text"
            value={event}
            list="minutes-events"
            onChange={(e) => setEvent(e.target.value)}
          />
          <datalist id="minutes-events">
            {history.events.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="start-books">
        {BOOKS.map((book) => (
          <button
            key={book.id}
            type="button"
            className="action primary"
            disabled={!ready}
            onClick={() => start(book.id)}
          >
            Start with {book.label}
          </button>
        ))}
      </div>
      <ImportDraft draft={null} setDraft={setDraft} lookups={lookups} />
    </>
  )
}

function Recorder({ draft, setDraft, lookups, history, onSent }) {
  const [editing, setEditing] = useState(null)
  const formRef = useRef(null)

  const calls = draft.calls
  const editCall = calls.find((call) => call.id === editing) ?? null

  function update(changes) {
    setDraft((previous) => ({ ...previous, ...changes }))
  }

  function saveCall(call) {
    setDraft((previous) => {
      const exists = previous.calls.some((each) => each.id === call.id)
      return {
        ...previous,
        calls: exists
          ? previous.calls.map((each) => (each.id === call.id ? call : each))
          : [...previous.calls, call],
      }
    })
    setEditing(null)
  }

  function removeCall(id) {
    setDraft((previous) => ({ ...previous, calls: previous.calls.filter((each) => each.id !== id) }))
    setEditing(null)
  }

  function move(id, step) {
    setDraft((previous) => {
      const list = [...previous.calls]
      const from = list.findIndex((each) => each.id === id)
      const to = from + step
      if (from < 0 || to < 0 || to >= list.length) return previous
      ;[list[from], list[to]] = [list[to], list[from]]
      return { ...previous, calls: list }
    })
  }

  function startEdit(id) {
    setEditing(id)
    formRef.current?.scrollIntoView({ block: 'start' })
  }

  // The leaders of this singing, then the regulars, in alphabetical order. A
  // button keeps its place from one call to the next, so the minutes taker
  // finds a name where it was.
  const buttons = useMemo(() => {
    const names = []
    for (const call of calls) {
      for (const name of call.leaders) if (!names.includes(name)) names.push(name)
    }
    for (const name of history.regulars) {
      if (names.length >= LEADER_BUTTONS) break
      if (!names.includes(name)) names.push(name)
    }
    return names.sort((a, b) => a.localeCompare(b))
  }, [calls, history.regulars])

  return (
    <>
      <h2 className="minutes-title">{draft.event}</h2>
      <details className="minutes-details">
        <summary>
          {germanDate(draft.date)} · {calls.length} {calls.length === 1 ? 'call' : 'calls'} · change
          event or date
        </summary>
        <div className="minutes-fields">
          <label className="field">
            <span className="field-label">Event</span>
            <input
              type="text"
              value={draft.event}
              list="minutes-events-edit"
              onChange={(e) => update({ event: e.target.value })}
              onBlur={() => lastEvent.set(draft.event.trim())}
            />
            <datalist id="minutes-events-edit">
              {history.events.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">Date</span>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => e.target.value && update({ date: e.target.value })}
            />
          </label>
        </div>
      </details>

      <div className="now-book">
        <p>
          Now singing from <strong>{bookLabel(draft.bookId)}</strong>
        </p>
        <button
          type="button"
          className="action"
          onClick={() => update({ bookId: otherBook(draft.bookId) })}
        >
          Switch to {bookLabel(otherBook(draft.bookId))}
        </button>
      </div>

      <div ref={formRef}>
        <CallForm
          key={editing ?? `new-${calls.length}-${draft.bookId}`}
          call={editCall}
          bookId={editCall?.bookId ?? draft.bookId}
          lookups={lookups}
          history={history}
          buttons={buttons}
          onSave={saveCall}
          onCancel={() => setEditing(null)}
          onDelete={removeCall}
        />
      </div>

      <CallList
        calls={calls}
        lookups={lookups}
        editing={editing}
        onEdit={startEdit}
        onMove={move}
      />

      <SendPanel draft={draft} setDraft={setDraft} onSent={onSent} />
      <Handover draft={draft} setDraft={setDraft} lookups={lookups} />
      <FacebookPost draft={draft} lookups={lookups} />
    </>
  )
}

/**
 * The form of one call. With `call` null it adds a new call to the book the
 * singers use now. With a call it edits that call, and the book of the call
 * can change.
 */
function CallForm({ call, bookId: initialBook, lookups, history, buttons, onSave, onCancel, onDelete }) {
  const [leaders, setLeaders] = useState(call?.leaders ?? [])
  const [leaderText, setLeaderText] = useState('')
  const [bookId, setBookId] = useState(initialBook)
  const [songText, setSongText] = useState('')
  const [page, setPage] = useState(call?.page ?? null)
  const [notes, setNotes] = useState(call?.notes ?? '')
  const songRef = useRef(null)

  const songs = lookups[bookId]
  const chosen = page === null ? null : songs?.byPage.get(page.toLowerCase()) ?? null
  const choices = useMemo(() => (songs ? songChoices(songs, songText) : []), [songs, songText])
  const exactPage = songs?.byPage.has(songText.trim().toLowerCase())
  const suggestions = useMemo(
    () => leaderSuggestions(history, leaderText).filter((name) => !leaders.includes(name)),
    [history, leaderText, leaders],
  )
  const typedIsKnown = history.ranked.some((entry) => entry.name === leaderText.trim())

  function toggleLeader(name) {
    setLeaders((previous) =>
      previous.includes(name) ? previous.filter((each) => each !== name) : [...previous, name],
    )
    setLeaderText('')
    if (page === null) songRef.current?.focus()
  }

  function addTyped() {
    const name = suggestions[0] ?? leaderText.trim()
    if (name) toggleLeader(name)
  }

  // The page the form would save: the chosen song, or else the best match of
  // the text in the song field.
  function pickedPage() {
    if (page !== null) return page
    if (choices.length > 0) return choices[0].page
    const text = songText.trim()
    return text === '' ? null : text
  }

  function save() {
    const finalPage = pickedPage()
    if (leaders.length === 0 || finalPage === null) return
    onSave({ id: call?.id ?? newId(), bookId, leaders, page: finalPage, notes: notes.trim() })
  }

  function onSongKey(event) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const next = pickedPage()
    if (next === null) return
    setPage(next)
    setSongText('')
    if (leaders.length > 0 && !call) {
      onSave({ id: newId(), bookId, leaders, page: next, notes: notes.trim() })
    }
  }

  const canSave = leaders.length > 0 && pickedPage() !== null

  return (
    <div className={call ? 'call-form editing' : 'call-form'}>
      <p className="field-label">{call ? 'Edit call' : `New call · ${bookLabel(bookId)}`}</p>

      <div className="field">
        <span className="field-label">Leader</span>
        <div className="chips" role="group" aria-label="Leaders">
          {[...buttons, ...leaders.filter((name) => !buttons.includes(name))].map((name) => {
            const on = leaders.includes(name)
            return (
              <button
                key={name}
                type="button"
                className={on ? 'chip on' : 'chip'}
                aria-pressed={on}
                onClick={() => toggleLeader(name)}
              >
                {name}
              </button>
            )
          })}
        </div>
        <input
          type="text"
          value={leaderText}
          placeholder="Another leader"
          autoComplete="off"
          onChange={(e) => setLeaderText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTyped()
            }
          }}
        />
        {leaderText.trim() !== '' && (
          <div className="chips suggestions">
            {suggestions.map((name) => (
              <button key={name} type="button" className="chip" onClick={() => toggleLeader(name)}>
                {name}
              </button>
            ))}
            {!typedIsKnown && (
              <button
                type="button"
                className="chip new"
                onClick={() => toggleLeader(leaderText.trim())}
              >
                New leader “{leaderText.trim()}”
              </button>
            )}
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">Song</span>
        {page !== null ? (
          <div className="picked-song">
            <span className="song-page">{chosen ? chosen.page : page}</span>
            <span className="picked-title">{chosen ? chosen.title : 'Not in the book'}</span>
            <button type="button" className="link-button" onClick={() => setPage(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              ref={songRef}
              type="text"
              value={songText}
              placeholder="Page or title, e.g. 178t or Africa"
              autoComplete="off"
              onChange={(e) => setSongText(e.target.value)}
              onKeyDown={onSongKey}
            />
            {songText.trim() !== '' && (
              <div className="choices">
                {choices.map((entry) => (
                  <button
                    key={entry.page}
                    type="button"
                    className="choice"
                    onClick={() => {
                      setPage(entry.page)
                      setSongText('')
                    }}
                  >
                    <span className="song-page">{entry.page}</span> {entry.title}
                  </button>
                ))}
                {!exactPage && (
                  <button
                    type="button"
                    className="choice muted"
                    onClick={() => {
                      setPage(songText.trim())
                      setSongText('')
                    }}
                  >
                    Use “{songText.trim()}”. It is not in the book.
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <label className="field">
        <span className="field-label">Note</span>
        <input
          type="text"
          value={notes}
          placeholder="Optional, e.g. for Jakob"
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
      </label>

      {call && (
        <label className="field">
          <span className="field-label">Book</span>
          <select
            value={bookId}
            onChange={(e) => {
              setBookId(e.target.value)
            }}
          >
            {BOOKS.map((book) => (
              <option key={book.id} value={book.id}>
                {book.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="form-actions">
        <button type="button" className="action primary" disabled={!canSave} onClick={save}>
          {call ? 'Save call' : 'Add call'}
        </button>
        {call && (
          <>
            <button type="button" className="action" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="action danger"
              onClick={() => {
                if (window.confirm('Delete this call?')) onDelete(call.id)
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CallList({ calls, lookups, editing, onEdit, onMove, readOnly = false }) {
  if (calls.length === 0) {
    return <p className="empty">No call yet. Pick a leader and a song above.</p>
  }
  const items = []
  let bookId = null
  calls.forEach((call, index) => {
    if (call.bookId !== bookId) {
      bookId = call.bookId
      items.push(
        <li key={`head-${index}`} className="call-book">
          {bookLabel(bookId)}
        </li>,
      )
    }
    const song = lookups[call.bookId]?.byPage.get(call.page.toLowerCase())
    items.push(
      <li key={call.id} className={editing === call.id ? 'call editing' : 'call'}>
        <button
          type="button"
          className="call-button"
          disabled={readOnly}
          onClick={() => onEdit(call.id)}
        >
          <span className="rank">{index + 1}</span>
          <span className="song-page">{song ? song.page : call.page}</span>
          <span className="call-text">
            <span className="call-title">
              {song ? song.title : <span className="tag">not in the book</span>}
            </span>
            <span className="call-leader">
              {leaderLabel(call.leaders)}
              {call.notes && <span className="muted"> · {call.notes}</span>}
            </span>
          </span>
        </button>
        {!readOnly && (
        <span className="call-move">
          <button
            type="button"
            className="move"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(call.id, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="move"
            aria-label="Move down"
            disabled={index === calls.length - 1}
            onClick={() => onMove(call.id, 1)}
          >
            ↓
          </button>
        </span>
        )}
      </li>,
    )
  })
  return <ol className="calls">{items}</ol>
}

function countLine(counts) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([bookId, count]) => `${count} in the ${bookLabel(bookId)}`)
    .join(' and ')
}

function SendPanel({ draft, setDraft, onSent }) {
  const [state, setState] = useState({ step: 'idle' })
  const [password, setPassword] = useState('')

  async function send(force = false, typed = null) {
    const secret = typed ?? savedPassword.get()
    if (!secret) {
      setState({ step: 'password' })
      return
    }
    setState({ step: 'sending' })
    const answer = await sendMinutes(draft, secret, { force })
    if (answer.ok) {
      savedPassword.set(secret)
      setDraft((previous) => ({ ...previous, status: 'sent', sentAt: new Date().toISOString(), written: answer.written }))
      onSent()
      return
    }
    if (answer.reason === 'password') {
      savedPassword.set(null)
      setState({ step: 'password', message: 'Wrong password. Try again.' })
      return
    }
    if (typed) savedPassword.set(typed)
    if (answer.reason === 'exists') {
      setState({ step: 'exists', existing: answer.existing })
      return
    }
    setState({ step: 'error', message: answer.message })
  }

  const empty = draft.calls.length === 0

  return (
    <div className="send-panel">
      {state.step === 'password' && (
        <form
          className="minutes-fields"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) send(false, password)
          }}
        >
          <label className="field">
            <span className="field-label">Password for the sheet</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {state.message && <p className="warning">{state.message}</p>}
          <button type="submit" className="action primary" disabled={!password}>
            Send
          </button>
        </form>
      )}

      {state.step === 'exists' && (
        <div className="send-question">
          <p>
            This singing already has {countLine(state.existing)} {totalOf(state.existing) === 1 ? 'call' : 'calls'} in
            the sheet. Add these calls after them?
          </p>
          <div className="form-actions">
            <button type="button" className="action primary" onClick={() => send(true)}>
              Send anyway
            </button>
            <button type="button" className="action" onClick={() => setState({ step: 'idle' })}>
              Keep draft
            </button>
          </div>
        </div>
      )}

      {state.step === 'error' && <p className="warning">{state.message}</p>}

      {state.step !== 'password' && state.step !== 'exists' && (
        <button
          type="button"
          className="action primary wide"
          disabled={empty || state.step === 'sending'}
          onClick={() => send(false)}
        >
          {state.step === 'sending' ? 'Sending…' : `Send ${draft.calls.length} ${draft.calls.length === 1 ? 'call' : 'calls'} to the sheet`}
        </button>
      )}
    </div>
  )
}

function totalOf(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

function Handover({ draft, setDraft, lookups }) {
  const [copied, setCopied] = useState('')
  const text = formatHandover(draft, BOOKS, lookups)

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch {
        // The minutes taker closed the share sheet. The copy below still works.
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Copied. Paste it into a message to the next minutes taker.')
    } catch {
      setCopied('Copy the text below by hand.')
    }
  }

  return (
    <details className="minutes-details handover">
      <summary>Hand over or discard</summary>
      <p className="detail-summary">
        Send this text to the next minutes taker. They open Take minutes, paste it under Import a
        draft, and go on.
      </p>
      <textarea readOnly value={text} rows={Math.min(12, text.split('\n').length + 1)} />
      <div className="form-actions">
        <button type="button" className="action" onClick={share}>
          Share draft
        </button>
        <button
          type="button"
          className="action danger"
          onClick={() => {
            if (window.confirm('Discard this draft? Its calls are lost unless you sent or shared them.')) {
              setDraft(null)
            }
          }}
        >
          Discard draft
        </button>
      </div>
      {copied && <p className="detail-summary muted">{copied}</p>}
      <ImportDraft draft={draft} setDraft={setDraft} lookups={lookups} />
    </details>
  )
}

// The minutes for the Facebook page of the singers. After the send it stands
// open; before the send it is there in case the send fails.
function FacebookPost({ draft, lookups, open = false }) {
  const [status, setStatus] = useState('')
  const text = formatPost(draft, BOOKS, lookups)
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied.')
    } catch {
      setStatus('Copy the text by hand.')
    }
  }

  function save() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `minutes-${draft.date}-${draft.event.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function share() {
    try {
      await navigator.share({ text })
    } catch {
      // The minutes taker closed the share sheet.
    }
  }

  return (
    <details className="minutes-details" open={open}>
      <summary>Facebook post</summary>
      <textarea readOnly value={text} rows={Math.min(12, text.split('\n').length + 1)} />
      <div className="form-actions">
        <button type="button" className="action" onClick={copy}>
          Copy
        </button>
        <button type="button" className="action" onClick={save}>
          Save as file
        </button>
        {canShare && (
          <button type="button" className="action" onClick={share}>
            Share
          </button>
        )}
      </div>
      {status && <p className="detail-summary muted">{status}</p>}
    </details>
  )
}

function ImportDraft({ draft, setDraft, lookups }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  function importText() {
    let parsed
    try {
      parsed = parseHandover(text, BOOKS, lookups)
    } catch (problem) {
      setError(problem.message)
      return
    }
    if (
      draft &&
      draft.calls.length > 0 &&
      !window.confirm(`Replace this draft of ${draft.calls.length} calls with the imported one?`)
    ) {
      return
    }
    lastEvent.set(parsed.event)
    setDraft(parsed)
    setText('')
    setError('')
  }

  return (
    <details className="minutes-details">
      <summary>Import a draft</summary>
      <textarea
        value={text}
        rows={6}
        placeholder="Paste the handover text here"
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="warning">{error}</p>}
      <button type="button" className="action" disabled={text.trim() === ''} onClick={importText}>
        Import
      </button>
    </details>
  )
}

function SentSummary({ draft, setDraft, lookups }) {
  const sheetUrl = BOOKS.find((book) => book.id === draft.bookId)?.url
  return (
    <>
      <h2 className="minutes-title">{draft.event}</h2>
      <p className="detail-summary">
        Sent to the sheet {draft.sentAt ? new Date(draft.sentAt).toLocaleString('en-GB') : ''}:{' '}
        {countLine(draft.written ?? {})}. Fix any mistake in the sheet now.{' '}
        {sheetUrl && <a href={sheetUrl}>Open the sheet</a>}
      </p>
      <FacebookPost draft={draft} lookups={lookups} open />
      <CallList calls={draft.calls} lookups={lookups} readOnly />
      <button type="button" className="action primary wide" onClick={() => setDraft(null)}>
        New singing
      </button>
    </>
  )
}
