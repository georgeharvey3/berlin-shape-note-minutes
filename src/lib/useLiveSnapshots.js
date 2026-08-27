import { useCallback, useEffect, useRef, useState } from 'react'
import { SHEETS, fetchSheet } from './sheets.js'

/**
 * Read the sheets in the browser and keep the newest good data.
 *
 * The dashboard starts with the snapshot files, so the first paint needs no
 * network. Each sheet stands on its own: a sheet that answers gives live rows,
 * and a sheet that fails keeps its snapshot rows. The footer names the sheets
 * that failed.
 *
 * `fallbacks` holds one snapshot per sheet key.
 */
export function useLiveSnapshots(fallbacks) {
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
      SHEETS.map((sheet) =>
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
            failures.push({ sheetName: result.sheet.sheetName, error: result.error })
          }
        }
        return { snapshots, live, status: 'ready', failures }
      })
    })
  }, [])

  useEffect(() => {
    refresh()
    return () => abortRef.current?.abort()
  }, [refresh])

  const source =
    state.live.length === SHEETS.length ? 'live' : state.live.length === 0 ? 'snapshot' : 'mixed'

  // The oldest read in the set. It is the age of the numbers on screen.
  const fetchedAt = Object.values(state.snapshots)
    .map((snapshot) => snapshot.fetchedAt)
    .sort()[0]

  return { ...state, source, fetchedAt, refresh }
}
