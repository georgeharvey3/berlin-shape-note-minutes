import { useCallback, useEffect, useRef, useState } from 'react'
import { SHEETS, fetchSheet } from './sheets.js'

// Read the two sheets in the browser and keep the newest good data.
//
// The dashboard starts with the snapshot files, so the first paint needs no
// network. When the download of both sheets is complete, the live rows replace
// the snapshot rows. If the download fails, the snapshot stays on screen and
// the footer shows the reason.
export function useLiveSnapshots(fallback) {
  const [state, setState] = useState({
    minutes: fallback.minutes,
    songIndex: fallback.songIndex,
    source: 'snapshot',
    status: 'loading',
    error: null,
  })
  const abortRef = useRef(null)

  const refresh = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState((current) => ({ ...current, status: 'loading', error: null }))

    Promise.all([
      fetchSheet(SHEETS.minutes, { signal: controller.signal }),
      fetchSheet(SHEETS.songIndex, { signal: controller.signal }),
    ]).then(
      ([minutes, songIndex]) => {
        if (controller.signal.aborted) return
        setState({ minutes, songIndex, source: 'live', status: 'ready', error: null })
      },
      (error) => {
        if (controller.signal.aborted) return
        setState((current) => ({
          ...current,
          status: 'ready',
          error: error.message || String(error),
        }))
      },
    )

    return () => controller.abort()
  }, [])

  useEffect(() => {
    refresh()
    return () => abortRef.current?.abort()
  }, [refresh])

  return { ...state, refresh }
}
