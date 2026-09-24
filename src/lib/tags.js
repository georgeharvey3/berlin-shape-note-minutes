// The tags a reader puts on a song. They live in the browser, in
// localStorage, so they belong to one reader on one device and never reach the
// sheet.

import { useCallback, useEffect, useState } from 'react'

export const TAGS = [
  { id: 'want-to-call', label: 'Want to call' },
  { id: 'banger', label: 'Banger' },
  { id: 'hard', label: 'Hard' },
  { id: 'trash', label: 'Trash' },
]

const STORAGE_KEY = 'bsnm-song-tags-v1'

// The whole store: { [book id]: { [song key]: [tag id, …] } }. A private window
// or blocked site data can make the store throw, so a failed read gives an
// empty store and a failed write keeps the tags for this visit only.
function readStore() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Nothing to do: the tags stay in memory until the page closes.
  }
}

/**
 * The tags of one book. `tagsOf(key)` gives the tag ids of a song, and
 * `toggle(key, tag)` puts a tag on or takes it off.
 */
export function useSongTags(bookId) {
  const [store, setStore] = useState(readStore)

  // A second tab of the dashboard writes the same store.
  useEffect(() => {
    function onStorage(event) {
      if (event.key === STORAGE_KEY) setStore(readStore())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const bookTags = store[bookId] ?? {}

  const tagsOf = useCallback((key) => bookTags[key] ?? [], [bookTags])

  const toggle = useCallback(
    (key, tag) => {
      setStore((previous) => {
        const inBook = { ...(previous[bookId] ?? {}) }
        const current = inBook[key] ?? []
        const next = current.includes(tag)
          ? current.filter((each) => each !== tag)
          : TAGS.map((each) => each.id).filter((id) => id === tag || current.includes(id))
        if (next.length === 0) delete inBook[key]
        else inBook[key] = next
        const updated = { ...previous, [bookId]: inBook }
        writeStore(updated)
        return updated
      })
    },
    [bookId],
  )

  return { tagsOf, toggle, tagged: bookTags }
}
