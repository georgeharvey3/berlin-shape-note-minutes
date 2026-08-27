import { useMemo, useState } from 'react'
import { MINUTES_SHEETS, BOOK_SHEETS, toObjects } from './lib/sheets.js'
import { buildBook, readBookIndex, EDITIONS } from './lib/books.js'
import { useLiveSnapshots } from './lib/useLiveSnapshots.js'
import {
  cleanAllRows,
  resolveCalls,
  editionsOf,
  songsInEditions,
  buildLeaderboard,
  summarise,
  matchesQuery,
  findLeaders,
  callsByLeaders,
} from './lib/minutes.js'
import minutes2021 from './data/minutes-2021.json'
import minutes2022 from './data/minutes-2022.json'
import minutes2023 from './data/minutes-2023.json'
import minutes2024 from './data/minutes-2024.json'
import minutes2025 from './data/minutes-2025.json'
import minutes2026 from './data/minutes-2026.json'
import book1991 from './data/book-1991.json'
import book2025 from './data/book-2025.json'

const FALLBACKS = {
  minutes2021,
  minutes2022,
  minutes2023,
  minutes2024,
  minutes2025,
  minutes2026,
  book1991,
  book2025,
}

const TOP_N = 25

// Which part of the book the list shows.
const SONG_SETS = [
  { id: 'called', label: 'Called' },
  { id: 'uncalled', label: 'Never called' },
  { id: 'all', label: 'All songs' },
]

const EDITION_LABELS = Object.fromEntries(EDITIONS.map((edition) => [edition.id, edition.label]))

export default function App() {
  const [query, setQuery] = useState('')
  const [songSet, setSongSet] = useState('called')
  const [showAll, setShowAll] = useState(false)
  const [openSong, setOpenSong] = useState(null)
  // null means every year. A list means the years the reader chose.
  const [chosenYears, setChosenYears] = useState(null)
  // A view the user picked by hand, with the query it belongs to. A new query
  // drops the choice and the dashboard picks the view again.
  const [pickedView, setPickedView] = useState(null)

  // The rows come from the sheets themselves. The bundled snapshots hold the
  // first paint and stay on screen if a download fails.
  const { snapshots, source, status, failures, fetchedAt, refresh } = useLiveSnapshots(FALLBACKS)

  // The book, from the two "Song Frequency" sheets. It links a song of the
  // 1991 revision to the same song of the 2025 revision.
  const book = useMemo(
    () =>
      buildBook({
        1991: readBookIndex(toObjects(snapshots.book1991)),
        2025: readBookIndex(toObjects(snapshots.book2025)),
      }),
    [snapshots.book1991, snapshots.book2025],
  )

  const { calls, years, repairedDates, droppedRows, offBookCalls, editionDays } = useMemo(() => {
    const cleaned = cleanAllRows(
      MINUTES_SHEETS.map((sheet) => ({ sheet, rows: toObjects(snapshots[sheet.key]) })),
    )
    const resolved = resolveCalls(cleaned.calls, book)
    return {
      calls: resolved.calls,
      editionDays: resolved.editions,
      offBookCalls: resolved.offBookCalls,
      years: cleaned.years,
      repairedDates: cleaned.repairedDates,
      droppedRows: cleaned.droppedRows,
    }
  }, [snapshots, book])

  const callsPerYear = useMemo(() => {
    const counts = new Map()
    for (const call of calls) counts.set(call.year, (counts.get(call.year) ?? 0) + 1)
    return counts
  }, [calls])

  // The first day on which the singers used the 2025 revision.
  const changeDay = useMemo(() => {
    const days = [...editionDays.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const found = days.find(([, edition]) => edition === '2025')
    return found ? found[0] : null
  }, [editionDays])

  const allYears = chosenYears === null
  const activeYears = allYears ? years : chosenYears

  const yearCalls = useMemo(() => {
    if (allYears) return calls
    const wanted = new Set(activeYears)
    return calls.filter((call) => wanted.has(call.year))
  }, [calls, allYears, activeYears])

  // The editions the chosen years used, and the songs those editions have.
  const editions = useMemo(() => editionsOf(yearCalls), [yearCalls])
  const bookSongs = useMemo(() => songsInEditions(book, editions), [book, editions])
  const leaderboard = useMemo(
    () => buildLeaderboard(yearCalls, bookSongs, editions),
    [yearCalls, bookSongs, editions],
  )
  const summary = useMemo(() => summarise(yearCalls, leaderboard), [yearCalls, leaderboard])
  const mixedEditions = editions.size > 1

  // The songs of the chosen set. "Called" runs by the number of calls. The
  // other two sets run in book order.
  const inSet = useMemo(() => {
    if (songSet === 'called') return leaderboard.filter((song) => song.count > 0)
    const byBook = (a, b) => a.bookOrder - b.bookOrder
    if (songSet === 'uncalled') {
      return leaderboard.filter((song) => song.count === 0).sort(byBook)
    }
    return [...leaderboard].sort(byBook)
  }, [leaderboard, songSet])

  const songMatches = useMemo(
    () => inSet.filter((song) => matchesQuery(song, query)),
    [inSet, query],
  )

  const leaderNames = useMemo(() => findLeaders(yearCalls, query), [yearCalls, query])

  // The songs one leader called, counted for that leader only.
  const leaderSongs = useMemo(() => {
    if (leaderNames.length === 0) return []
    return buildLeaderboard(callsByLeaders(yearCalls, leaderNames), bookSongs, editions).filter(
      (song) => song.count > 0,
    )
  }, [yearCalls, leaderNames, bookSongs, editions])

  const searching = query.trim() !== ''
  const hasSongs = songMatches.length > 0
  const hasLeaders = leaderNames.length > 0
  // A query that matches no song title and no page is a leader search.
  const defaultView = hasSongs || !hasLeaders ? 'songs' : 'leader'
  const view = pickedView && pickedView.query === query ? pickedView.view : defaultView
  const leaderView = searching && view === 'leader' && hasLeaders

  const board = leaderView ? leaderSongs : songMatches
  // The top-25 cap belongs to the ranked list only.
  const capped = !leaderView && songSet === 'called' && !searching && !showAll
  const visible = capped ? board.slice(0, TOP_N) : board
  // The bar scale is the whole set on screen, and not the rows that match the
  // search, so a search does not change the length of a bar.
  const scale = leaderView ? leaderSongs : leaderboard
  const maxCount = Math.max(1, ...scale.map((song) => song.count))
  const lastDay = yearCalls.length > 0 ? yearCalls[yearCalls.length - 1].dateLabel : '—'

  const leaderLabel =
    leaderNames.length === 1
      ? leaderNames[0]
      : `${leaderNames.length} leaders named “${query.trim()}”`
  const leaderCalls = leaderSongs.reduce((total, song) => total + song.count, 0)

  const yearLabel = allYears
    ? `${years[0]}–${years[years.length - 1]}`
    : activeYears.length === 1
      ? String(activeYears[0])
      : activeYears.join(', ')

  function pick(next) {
    setPickedView({ query, view: next })
    setOpenSong(null)
  }

  function search(value) {
    setQuery(value)
    setPickedView(null)
    setOpenSong(null)
  }

  function chooseSet(next) {
    setSongSet(next)
    setShowAll(false)
    setOpenSong(null)
  }

  // A click on a year scopes the dashboard to that year. A second click on a
  // year adds it or takes it away. The last year cannot go, so a click on it
  // brings every year back.
  function toggleYear(year) {
    setOpenSong(null)
    setShowAll(false)
    if (allYears) {
      setChosenYears([year])
      return
    }
    const wanted = new Set(chosenYears)
    if (wanted.has(year)) wanted.delete(year)
    else wanted.add(year)
    if (wanted.size === 0 || wanted.size === years.length) setChosenYears(null)
    else setChosenYears([...wanted].sort((a, b) => a - b))
  }

  function chooseAllYears() {
    setChosenYears(null)
    setOpenSong(null)
    setShowAll(false)
  }

  return (
    <div className="viz-root page">
      <header className="masthead">
        <p className="eyebrow">Berlin Sacred Harp · minutes {years[0]}–{years[years.length - 1]}</p>
        <h1>Which song gets called the most?</h1>
        <p className="lede">
          Every song called at the Berlin singings, from the shared minutes. The singers changed
          the book in September 2025, and a song keeps one row across the two editions. Latest
          singing in the data: {lastDay}.
        </p>
      </header>

      <section className="years" aria-label="Which years to count">
        <div className="years-row" role="group">
          <button
            type="button"
            className={allYears ? 'year on' : 'year'}
            aria-pressed={allYears}
            onClick={chooseAllYears}
          >
            All years
          </button>
          {years.map((year) => {
            const on = activeYears.includes(year)
            return (
              <button
                key={year}
                type="button"
                className={on ? 'year on' : 'year'}
                aria-pressed={on}
                onClick={() => toggleYear(year)}
              >
                {year}
                <span className="year-count">{callsPerYear.get(year) ?? 0}</span>
              </button>
            )
          })}
        </div>
        <p className="years-hint">
          {allYears
            ? 'Every year counts. Click a year to count that year alone.'
            : `Counting ${yearLabel}. Click another year to add it, or “All years” to count every year.`}{' '}
          {mixedEditions
            ? 'These years cross the change of the book, so a page can carry two numbers.'
            : `The singers used the ${EDITION_LABELS[[...editions][0]] ?? 'book'} in these years.`}
        </p>
      </section>

      <section className="stats" aria-label="Totals">
        <div className="stat stat-hero">
          <span className="stat-label">Calls in the minutes</span>
          <span className="stat-value hero">{summary.totalCalls.toLocaleString('en-GB')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Songs called</span>
          <span className="stat-value">{summary.uniqueSongs}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Never called</span>
          <span className="stat-value">{summary.uncalledSongs}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Singing days</span>
          <span className="stat-value">{summary.singingDays}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Leaders</span>
          <span className="stat-value">{summary.leaders}</span>
        </div>
      </section>

      <section className="board" aria-label="Song leaderboard">
        <div className="controls">
          <label className="search">
            <span className="search-label">Find a song, page or leader</span>
            <input
              type="search"
              value={query}
              placeholder="e.g. Windham, 38b, Mara"
              onChange={(event) => search(event.target.value)}
              autoComplete="off"
            />
          </label>
          {!leaderView && (
            <div className="views" role="group" aria-label="Which songs to show">
              {SONG_SETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={songSet === option.id ? 'view on' : 'view'}
                  aria-pressed={songSet === option.id}
                  onClick={() => chooseSet(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <p className="result-count" role="status">
            {leaderView
              ? `${leaderLabel} called ${leaderCalls} songs · ${board.length} different songs`
              : searching
                ? `${board.length} of ${inSet.length} songs match`
                : capped
                  ? `Top ${Math.min(TOP_N, inSet.length)} of ${inSet.length} songs`
                  : `${inSet.length} songs`}
          </p>
        </div>

        {searching && hasLeaders && hasSongs && (
          <div className="views views-search" role="group" aria-label="Search view">
            <button
              type="button"
              className={leaderView ? 'view' : 'view on'}
              onClick={() => pick('songs')}
              aria-pressed={!leaderView}
            >
              Songs ({songMatches.length})
            </button>
            <button
              type="button"
              className={leaderView ? 'view on' : 'view'}
              onClick={() => pick('leader')}
              aria-pressed={leaderView}
            >
              Called by {leaderLabel} ({leaderCalls})
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="empty">
            {searching ? `No song matches “${query.trim()}”.` : 'No song in this set.'}
          </p>
        ) : (
          <ol className="rows">
            {visible.map((song) => (
              <SongRow
                key={song.key}
                song={song}
                maxCount={maxCount}
                showRank={leaderView || songSet === 'called'}
                showEdition={mixedEditions}
                leaderView={leaderView}
                leaderLabel={leaderLabel}
                open={openSong === song.key}
                onToggle={() => setOpenSong(openSong === song.key ? null : song.key)}
              />
            ))}
          </ol>
        )}

        {capped && board.length > TOP_N && (
          <button type="button" className="more" onClick={() => setShowAll(true)}>
            Show all {board.length} songs
          </button>
        )}
        {!capped && !searching && !leaderView && songSet === 'called' && board.length > TOP_N && (
          <button type="button" className="more" onClick={() => setShowAll(false)}>
            Show top {TOP_N} only
          </button>
        )}
      </section>

      <footer className="footnotes">
        <p>
          {source === 'live'
            ? `Read from the sheet ${new Date(fetchedAt).toLocaleTimeString('en-GB')}`
            : `Snapshot taken ${new Date(fetchedAt).toLocaleString('en-GB')}`}{' '}
          · {MINUTES_SHEETS.length} year sheets and {BOOK_SHEETS.length} book sheets ·{' '}
          <a href={snapshots.minutes2026.source.url}>open the sheet</a> ·{' '}
          <button
            type="button"
            className="link-button"
            onClick={refresh}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Reading the sheets…' : 'Read the sheets again'}
          </button>
        </p>
        {failures.length > 0 && (
          <p className="warning" role="status">
            {failures.length === 1
              ? `The sheet “${failures[0].sheetName}” did not answer, so its numbers come from the snapshot. ${failures[0].error}`
              : `${failures.length} sheets did not answer, so their numbers come from the snapshot. ${failures[0].error}`}
          </p>
        )}
        <p className="muted">
          The 1991 revision of the book has {book.songs.filter((song) => song.editions['1991']).length}{' '}
          songs. The 2025 revision has {book.songs.filter((song) => song.editions['2025']).length}{' '}
          songs. {book.songs.filter((song) => song.status === 'added').length} songs are new,{' '}
          {book.songs.filter((song) => song.status === 'removed').length} songs went out, and{' '}
          {book.songs.filter((song) => song.status === 'both' && song.editions['1991'].page !== song.editions['2025'].page).length}{' '}
          songs moved to a new page. The dashboard counts the calls of the two editions together, so
          Africa on 178 and Africa on 178t are one song.
        </p>
        <p className="muted">
          {changeDay
            ? `The first singing with the 2025 revision is ${changeDay.split('-').reverse().join('.')}. The page and the title of each call name the edition, so the dashboard needs no cut-off date.`
            : 'Every singing in the data uses one edition of the book.'}{' '}
          {droppedRows} empty or unresolved minute rows skipped. {repairedDates} rows had a
          fill-down year in the Date column; their day and month match a real singing, so the year
          is moved back. {offBookCalls} calls name a song that neither edition has.
        </p>
      </footer>
    </div>
  )
}

function SongRow({ song, maxCount, showRank, showEdition, leaderView, leaderLabel, open, onToggle }) {
  const never = song.count === 0
  const width = `${Math.max((song.count / maxCount) * 100, 2)}%`
  const firstCall = never ? null : song.calls[0]
  const lastCall = never ? null : song.calls[song.calls.length - 1]
  const oldPage = song.editions['1991']?.page
  const newPage = song.editions['2025']?.page

  return (
    <li className={open ? 'row open' : 'row'}>
      <button
        type="button"
        className="row-button"
        onClick={onToggle}
        aria-expanded={never ? undefined : open}
        disabled={never}
      >
        <span className="rank">{showRank && !never ? song.rank : ''}</span>
        <span className="song-page">{song.page}</span>
        <span className="title">
          {song.title}
          {showEdition && song.movedFrom && <span className="tag">was {song.movedFrom}</span>}
          {showEdition && song.status === 'added' && <span className="tag">new in 2025</span>}
          {showEdition && song.status === 'removed' && <span className="tag">out in 2025</span>}
          {song.status === 'off-book' && <span className="tag">not in the book</span>}
        </span>
        <span className="track">{never ? null : <span className="bar" style={{ width }} />}</span>
        <span className={never ? 'count zero' : 'count'}>{song.count}</span>
      </button>

      {open && !never && (
        <div className="detail">
          <p className="detail-summary">
            {song.count === 1 ? 'Called once' : `Called ${song.count} times`}
            {leaderView ? ` by ${leaderLabel}` : ''} · first {firstCall.dateLabel} · last{' '}
            {lastCall.dateLabel}
          </p>
          {oldPage && newPage && oldPage !== newPage && (
            <p className="detail-summary muted">
              Page {oldPage} in the 1991 book and page {newPage} in the 2025 book.
            </p>
          )}
          {oldPage && !newPage && (
            <p className="detail-summary muted">
              Page {oldPage} in the 1991 book. The 2025 book does not have this song.
            </p>
          )}
          {!oldPage && newPage && (
            <p className="detail-summary muted">
              Page {newPage} in the 2025 book. The 1991 book did not have this song.
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Leader</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {song.calls.map((call) => (
                <tr key={`${call.date}-${call.order}`}>
                  <td>{call.dateLabel}</td>
                  <td>{call.leader || '—'}</td>
                  <td className="muted">{call.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  )
}
