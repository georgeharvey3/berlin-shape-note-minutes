import { useCallback, useMemo, useState } from 'react'
import { toObjects } from './lib/sheets.js'
import { buildBook, foldTitle, readBookIndex } from './lib/books.js'
import { forBook } from './lib/useLiveSnapshots.js'
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

const TOP_N = 25

// Which part of the book the list shows.
const SONG_SETS = [
  { id: 'called', label: 'Called' },
  { id: 'uncalled', label: 'Never called' },
  { id: 'all', label: 'All songs' },
]

/**
 * The buttons of the edition filter.
 *
 * A book with one edition needs no such filter, so it gets no buttons. `needs`
 * names the edition that the year filter must leave on screen, because a song
 * that only that edition has falls out of the song list with it.
 */
function editionSets(book) {
  if (book.editions.length < 2) return []
  const [older, newer] = book.editions
  return [
    { id: 'any', label: 'Any', match: () => true },
    { id: `in-${older.id}`, label: older.label, match: (song) => Boolean(song.editions[older.id]) },
    { id: `in-${newer.id}`, label: newer.label, match: (song) => Boolean(song.editions[newer.id]) },
    { id: 'both', label: 'Both editions', match: (song) => song.status === 'both' },
    {
      id: 'new',
      label: `New in ${newer.id}`,
      match: (song) => song.status === 'added',
      needs: newer.id,
    },
    {
      id: 'out',
      label: `Out in ${newer.id}`,
      match: (song) => song.status === 'removed',
      needs: older.id,
    },
  ]
}

// The edition filter the dashboard starts with. A book with two editions
// starts on its newer edition, because the singers use that book now. A book
// with one edition has no filter.
function defaultEditionSet(book) {
  if (book.editions.length < 2) return 'any'
  return `in-${book.editions[book.editions.length - 1].id}`
}

/**
 * The dashboard of one book.
 *
 * `definition` is the book from `sheets.js`. `live` is the shared live read of
 * every sheet of every book.
 */
export default function BookDashboard({ definition, live }) {
  const [query, setQuery] = useState('')
  const [songSet, setSongSet] = useState('called')
  const [editionSet, setEditionSet] = useState(() => defaultEditionSet(definition))
  const [showAll, setShowAll] = useState(false)
  const [openSong, setOpenSong] = useState(null)
  // null means every year. A list means the years the reader chose.
  const [chosenYears, setChosenYears] = useState(null)
  // A view the user picked by hand, with the query it belongs to. A new query
  // drops the choice and the dashboard picks the view again.
  const [pickedView, setPickedView] = useState(null)

  const { snapshots, status, refresh } = live
  const { source, fetchedAt, failures } = forBook(live, definition)

  const EDITION_SETS = useMemo(() => editionSets(definition), [definition])

  // The book, from its "Song Frequency" sheets. In a book with two editions it
  // links a song of the older edition to the same song of the newer one.
  const book = useMemo(
    () =>
      buildBook(
        definition,
        Object.fromEntries(
          definition.editions.map((edition) => [
            edition.id,
            readBookIndex(toObjects(snapshots[edition.key])),
          ]),
        ),
      ),
    [definition, snapshots],
  )

  const { calls, years } = useMemo(() => {
    const cleaned = cleanAllRows(
      definition.minutes.map((sheet) => ({ sheet, rows: toObjects(snapshots[sheet.key]) })),
    )
    const resolved = resolveCalls(cleaned.calls, book)
    return {
      calls: resolved.calls,
      years: cleaned.years,
    }
  }, [definition, snapshots, book])

  const callsPerYear = useMemo(() => {
    const counts = new Map()
    for (const call of calls) counts.set(call.year, (counts.get(call.year) ?? 0) + 1)
    return counts
  }, [calls])

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
    () => buildLeaderboard(yearCalls, book, bookSongs, editions),
    [yearCalls, book, bookSongs, editions],
  )
  const summary = useMemo(() => summarise(yearCalls, leaderboard), [yearCalls, leaderboard])
  const mixedEditions = editions.size > 1

  // A song that the newer edition added needs that edition on screen, and a
  // song that went out needs the older edition. The year filter can take an
  // edition away, so the choice falls back to "Any".
  const editionSetAvailable = Object.fromEntries(
    EDITION_SETS.map((option) => [option.id, !option.needs || editions.has(option.needs)]),
  )
  const activeEditionSet = editionSetAvailable[editionSet] ? editionSet : 'any'

  const byEditionSet = useCallback(
    (songs) => {
      const option = EDITION_SETS.find((each) => each.id === activeEditionSet)
      if (!option) return songs
      return songs.filter(option.match)
    },
    [EDITION_SETS, activeEditionSet],
  )

  // The songs the year filter and the edition filter leave. It is the scale of
  // the bars, so a search does not change the length of a bar but a filter does.
  const inBook = useMemo(() => byEditionSet(leaderboard), [leaderboard, byEditionSet])

  // The songs of the chosen set. "Called" runs by the number of calls. The
  // other two sets run in book order.
  const inSet = useMemo(() => {
    if (songSet === 'called') return inBook.filter((song) => song.count > 0)
    const byBook = (a, b) => a.bookOrder - b.bookOrder
    if (songSet === 'uncalled') {
      return inBook.filter((song) => song.count === 0).sort(byBook)
    }
    return [...inBook].sort(byBook)
  }, [inBook, songSet])

  const songMatches = useMemo(
    () => inSet.filter((song) => matchesQuery(song, query)),
    [inSet, query],
  )

  const leaderNames = useMemo(() => findLeaders(yearCalls, query), [yearCalls, query])

  // The songs one leader called, counted for that leader only.
  const leaderSongs = useMemo(() => {
    if (leaderNames.length === 0) return []
    return byEditionSet(
      buildLeaderboard(callsByLeaders(yearCalls, leaderNames), book, bookSongs, editions).filter(
        (song) => song.count > 0,
      ),
    )
  }, [yearCalls, leaderNames, book, bookSongs, editions, byEditionSet])

  const searching = query.trim() !== ''
  const hasSongs = songMatches.length > 0
  const hasLeaders = leaderNames.length > 0
  // A query that matches no song title and no page is a leader search.
  const defaultView = hasSongs || !hasLeaders ? 'songs' : 'leader'
  const view = pickedView && pickedView.query === query ? pickedView.view : defaultView
  const leaderView = searching && view === 'leader' && hasLeaders

  // A search that finds nothing often hits a filter, and not a missing song.
  // The book has "Sermon on the Mount" on page 508, but no leader called it,
  // so the set "Called" leaves it out. The message then names the filter.
  const missReason = useMemo(() => {
    if (!searching || hasSongs) return null
    if (inBook.some((song) => matchesQuery(song, query))) return 'set'
    if (leaderboard.some((song) => matchesQuery(song, query))) return 'edition'
    return null
  }, [searching, hasSongs, inBook, leaderboard, query])

  const board = leaderView ? leaderSongs : songMatches
  // The top-25 cap belongs to the ranked list only.
  const capped =
    !leaderView && songSet === 'called' && !searching && !showAll && board.length > TOP_N
  const visible = capped ? board.slice(0, TOP_N) : board
  const scale = leaderView ? leaderSongs : inBook
  const maxCount = Math.max(1, ...scale.map((song) => song.count))

  const leaderLabel =
    leaderNames.length === 1
      ? leaderNames[0]
      : `${leaderNames.length} leaders named “${query.trim()}”`
  const leaderCalls = leaderSongs.reduce((total, song) => total + song.count, 0)

  const editionLabels = Object.fromEntries(
    definition.editions.map((edition) => [edition.id, edition.label]),
  )

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

  function chooseEditionSet(next) {
    setEditionSet(next)
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
    <>
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
              placeholder={definition.searchHint}
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

        {EDITION_SETS.length > 0 && (
          <div className="edition-filter">
            <span className="edition-filter-label">Edition</span>
            <div className="views" role="group" aria-label="Which edition the song is in">
              {EDITION_SETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={activeEditionSet === option.id ? 'view on' : 'view'}
                  aria-pressed={activeEditionSet === option.id}
                  disabled={!editionSetAvailable[option.id]}
                  onClick={() => chooseEditionSet(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
            {!searching && 'No song in this set.'}
            {searching && missReason === 'set' && (
              <>
                No song of this set matches “{query.trim()}”. The book has it. The list “All songs”
                shows it.
              </>
            )}
            {searching && missReason === 'edition' && (
              <>
                No song of this edition matches “{query.trim()}”. The button “Any” of the edition
                filter shows it.
              </>
            )}
            {searching && missReason === null && `No song matches “${query.trim()}”.`}
          </p>
        ) : (
          <ol className="rows">
            {visible.map((song) => (
              <SongRow
                key={song.key}
                song={song}
                book={book}
                maxCount={maxCount}
                showRank={leaderView || songSet === 'called'}
                showEdition={mixedEditions}
                offBookLabel={definition.offBookLabel}
                editionLabels={editionLabels}
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
          · {definition.minutes.length} year sheets and {definition.editions.length}{' '}
          {definition.editions.length === 1 ? 'book sheet' : 'book sheets'} ·{' '}
          <a href={definition.url}>open the sheet</a> ·{' '}
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
              ? `The sheet “${failures[0].sheet.sheetName}” did not answer, so its numbers come from the snapshot. ${failures[0].error}`
              : `${failures.length} sheets did not answer, so their numbers come from the snapshot. ${failures[0].error}`}
          </p>
        )}
      </footer>
    </>
  )
}

function SongRow({
  song,
  book,
  maxCount,
  showRank,
  showEdition,
  offBookLabel,
  editionLabels,
  leaderView,
  leaderLabel,
  open,
  onToggle,
}) {
  const never = song.count === 0
  const width = `${Math.max((song.count / maxCount) * 100, 2)}%`
  const firstCall = never ? null : song.calls[0]
  const lastCall = never ? null : song.calls[song.calls.length - 1]
  const [older, newer] = [book.editionIds[0], book.currentEdition]
  const oldPage = song.editions[older]?.page
  const newPage = song.editions[newer]?.page
  const oldTitle = song.editions[older]?.title
  const newTitle = song.editions[newer]?.title
  // The 2025 edition gives some songs their original title again: page 227 is
  // "Ode of Life's Journey" and no longer "Ode on Life's Journey".
  const renamed =
    Boolean(oldTitle) && Boolean(newTitle) && foldTitle(oldTitle) !== foldTitle(newTitle)
  const twoEditions = book.editionIds.length > 1
  // The Shenandoah sheet names the source book and the mode of each song.
  const about = [song.mode, song.source].filter(Boolean).join(' · ')

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
          <span className="title-text">{song.title}</span>
          {showEdition && song.movedFrom && <span className="tag">was {song.movedFrom}</span>}
          {showEdition && song.status === 'added' && <span className="tag">new in {newer}</span>}
          {showEdition && song.status === 'removed' && <span className="tag">out in {newer}</span>}
          {song.status === 'off-book' && <span className="tag">{offBookLabel}</span>}
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
          {twoEditions && oldPage && newPage && oldPage !== newPage && (
            <p className="detail-summary muted">
              Page {oldPage} in the {editionLabels[older]} and page {newPage} in the{' '}
              {editionLabels[newer]}.
            </p>
          )}
          {twoEditions && oldPage && !newPage && (
            <p className="detail-summary muted">
              Page {oldPage} in the {editionLabels[older]}. The {editionLabels[newer]} does not have
              this song.
            </p>
          )}
          {twoEditions && !oldPage && newPage && (
            <p className="detail-summary muted">
              Page {newPage} in the {editionLabels[newer]}. The {editionLabels[older]} did not have
              this song.
            </p>
          )}
          {twoEditions && renamed && (
            <p className="detail-summary muted">
              The {editionLabels[older]} gives the title “{oldTitle}”.
            </p>
          )}
          {!twoEditions && about !== '' && (
            <p className="detail-summary muted">
              Page {song.page} · {about}
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
