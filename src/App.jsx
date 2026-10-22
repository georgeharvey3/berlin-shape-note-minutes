import { useEffect, useState } from 'react'
import { BOOKS, SHEETS } from './lib/sheets.js'
import { useLiveSnapshots } from './lib/useLiveSnapshots.js'
import { useDraft } from './lib/draft.js'
import BookDashboard from './BookDashboard.jsx'
import MinutesTaker from './MinutesTaker.jsx'

// One snapshot file per sheet, under `src/data/<book id>/`. The key of a
// snapshot is the `file` of its sheet, so a new book needs no import here.
const files = import.meta.glob('./data/*/*.json', { eager: true, import: 'default' })
const FALLBACKS = Object.fromEntries(
  Object.entries(files).map(([path, snapshot]) => [path.replace('./data/', ''), snapshot]),
)

// The screen of the minutes taker sits at its own address, so most readers
// never see it. A minutes taker can bookmark it.
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const [bookId, setBookId] = useState(BOOKS[0].id)
  const hash = useHash()
  const [draft, setDraft] = useDraft()
  const takingMinutes = hash === '#minutes'
  // The browser reads every sheet of both books once, so a click on a tab
  // needs no new download.
  const live = useLiveSnapshots(SHEETS, FALLBACKS)
  const book = BOOKS.find((each) => each.id === bookId) ?? BOOKS[0]

  return (
    <div className="page">
      {/* The masthead of a printed record: the name of the record, the two
          books as the issue row, and a double rule to close it. */}
      <header className="masthead">
        <h1 className="mast-name">Berlin Shape Note Minutes</h1>

        {!takingMinutes && (
        <nav className="books" aria-label="Which book to show">
          {BOOKS.map((each) => (
            <button
              key={each.id}
              type="button"
              className={each.id === book.id ? 'book on' : 'book'}
              aria-current={each.id === book.id ? 'page' : undefined}
              onClick={() => setBookId(each.id)}
            >
              {each.label}
            </button>
          ))}
        </nav>
        )}

        <hr className="mast-rule" aria-hidden="true" />
      </header>

      {/* A draft in progress follows the minutes taker round the dashboard,
          so a look at a song never loses the place in the singing. */}
      {!takingMinutes && draft?.status === 'recording' && (
        <p className="in-progress" role="status">
          Minutes in progress: {draft.calls.length} {draft.calls.length === 1 ? 'call' : 'calls'}.{' '}
          <a href="#minutes">Continue</a>
        </p>
      )}

      {takingMinutes ? (
        <MinutesTaker live={live} draft={draft} setDraft={setDraft} />
      ) : (
        // The key drops the filters and the open song when the reader changes
        // the book, because the songs and the pages are not the same.
        <BookDashboard key={book.id} definition={book} live={live} />
      )}
    </div>
  )
}
