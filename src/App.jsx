import { useMemo, useState } from 'react'
import snapshot from './data/minutes-2026.json'
import songIndexSnapshot from './data/song-index.json'
import {
  cleanRows,
  buildLeaderboard,
  summarise,
  matchesQuery,
  findLeaders,
  callsByLeaders,
  readSongIndex,
} from './lib/minutes.js'

const TOP_N = 25

// Which part of the book the list shows.
const SONG_SETS = [
  { id: 'called', label: 'Called' },
  { id: 'uncalled', label: 'Never called' },
  { id: 'all', label: 'All songs' },
]

export default function App() {
  const [query, setQuery] = useState('')
  const [songSet, setSongSet] = useState('called')
  const [showAll, setShowAll] = useState(false)
  const [openSong, setOpenSong] = useState(null)
  // A view the user picked by hand, with the query it belongs to. A new query
  // drops the choice and the dashboard picks the view again.
  const [pickedView, setPickedView] = useState(null)

  const { calls, leaderboard, summary, repairedDates, droppedRows } = useMemo(() => {
    const cleaned = cleanRows(snapshot.rows)
    const bookSongs = readSongIndex(songIndexSnapshot.rows)
    const board = buildLeaderboard(cleaned.calls, bookSongs)
    return {
      calls: cleaned.calls,
      leaderboard: board,
      summary: summarise(cleaned.calls, board),
      repairedDates: cleaned.repairedDates,
      droppedRows: cleaned.droppedRows,
    }
  }, [])

  // The songs of the chosen set. "Called" runs by the number of calls. The
  // other two sets run in book order, from page 26 to page 575.
  const inSet = useMemo(() => {
    if (songSet === 'called') return leaderboard.filter((song) => song.count > 0)
    const byBook = (a, b) => (a.bookOrder ?? 0) - (b.bookOrder ?? 0)
    if (songSet === 'uncalled') {
      return leaderboard.filter((song) => song.count === 0).sort(byBook)
    }
    return [...leaderboard].sort(byBook)
  }, [leaderboard, songSet])

  const songMatches = useMemo(
    () => inSet.filter((song) => matchesQuery(song, query)),
    [inSet, query],
  )

  const leaderNames = useMemo(() => findLeaders(calls, query), [calls, query])

  // The songs one leader called, counted for that leader only.
  const leaderSongs = useMemo(() => {
    if (leaderNames.length === 0) return []
    return buildLeaderboard(callsByLeaders(calls, leaderNames))
  }, [calls, leaderNames])

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
  const maxCount = leaderboard.length > 0 ? Math.max(...leaderboard.map((song) => song.count)) : 1
  const lastDay = calls.length > 0 ? calls[calls.length - 1].dateLabel : '—'

  const leaderLabel =
    leaderNames.length === 1 ? leaderNames[0] : `${leaderNames.length} leaders named “${query.trim()}”`
  const leaderCalls = leaderSongs.reduce((total, song) => total + song.count, 0)

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

  return (
    <div className="viz-root page">
      <header className="masthead">
        <p className="eyebrow">Berlin Sacred Harp · {snapshot.source.sheetName}</p>
        <h1>Which song gets called the most?</h1>
        <p className="lede">
          Every song called at the Thursday Singing at Refugio, from the shared minutes.
          Latest singing in the data: {lastDay}.
        </p>
      </header>

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
            {searching
              ? `No song matches “${query.trim()}”.`
              : 'No song in this set.'}
          </p>
        ) : (
          <ol className="rows">
            {visible.map((song) => (
              <SongRow
                key={song.key}
                song={song}
                maxCount={maxCount}
                showRank={leaderView || songSet === 'called'}
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
          Snapshot taken {new Date(snapshot.fetchedAt).toLocaleString('en-GB')} · {snapshot.rowCount}{' '}
          sheet rows · <a href={snapshot.source.url}>open the sheet</a> · refresh with{' '}
          <code>npm run sync</code>.
        </p>
        <p className="muted">
          The book has {songIndexSnapshot.rowCount} songs, from the “
          {songIndexSnapshot.source.sheetName}” sheet. {droppedRows} empty or unresolved minute rows
          skipped. {repairedDates} rows had a fill-down year in the Date column (02.04.2027 and
          later); their day and month match a real singing, so the year is moved back.
        </p>
      </footer>
    </div>
  )
}

function SongRow({ song, maxCount, showRank, leaderView, leaderLabel, open, onToggle }) {
  const never = song.count === 0
  const width = `${Math.max((song.count / maxCount) * 100, 2)}%`
  const firstCall = never ? null : song.calls[0]
  const lastCall = never ? null : song.calls[song.calls.length - 1]

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
        <span className="title">{song.title}</span>
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
                <tr key={`${call.order}`}>
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
