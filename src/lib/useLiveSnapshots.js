import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSheet } from './sheets.js'

/**
 * Read the sheets in the browser and keep the newest good data.
 *
 * The dashboard starts with the snapshot files, so the first paint needs no
 * network. Each sheet stands on its own: a sheet that answers gives live rows,
 * and a sheet that fails keeps its snapshot rows. The footer of each book
 * names the sheets of that book that failed.
 *
 * `sheets` holds every sheet of every book. `fallbacks` holds one snapshot per
 * sheet key.
 */
export function useLiveSnapshots(sheets, fallbacks) {
  const [state, setState] = useState(() => ({
    snapshots: fallbacks,
    live: [],
    status: 'loading',
    failures: [],
  }))
  const abortRef = useRef(null)

  const refresh = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState((current) => ({ ...current, status: 'loading' }))

    Promise.all(
      sheets.map((sheet) =>
        fetchSheet(sheet, { signal: controller.signal }).then(
          (snapshot) => ({ sheet, snapshot }),
          (error) => ({ sheet, error: error.message || String(error) }),
        ),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return
      setState((current) => {
        const snapshots = { ...current.snapshots }
        const live = []
        const failures = []
        for (const result of results) {
          if (result.snapshot) {
            snapshots[result.sheet.key] = result.snapshot
            live.push(result.sheet.key)
          } else {
            failures.push({ sheet: result.sheet, error: result.error })
          }
        }
        return { snapshots, live, status: 'ready', failures }
      })
    })
  }, [sheets])

  useEffect(() => {
    refresh()
    return () => abortRef.current?.abort()
  }, [refresh])

  return { ...state, refresh }
}

/**
 * The part of the live read that belongs to one book.
 *
 * The reader sees one book at a time, so the footer reports the sheets of that
 * book only.
 */
export function forBook(live, book) {
  const sheets = [...book.minutes, ...book.editions]
  const keys = new Set(sheets.map((sheet) => sheet.key))
  const liveCount = live.live.filter((key) => keys.has(key)).length
  const source = liveCount === sheets.length ? 'live' : liveCount === 0 ? 'snapshot' : 'mixed'

  // The oldest read in the set. It is the age of the numbers on screen.
  const fetchedAt = sheets
    .map((sheet) => live.snapshots[sheet.key].fetchedAt)
    .sort()[0]

  return {
    source,
    fetchedAt,
    failures: live.failures.filter((failure) => failure.sheet.bookId === book.id),
  }
}
