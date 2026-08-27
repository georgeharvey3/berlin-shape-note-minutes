# Berlin Sacred Harp — Minutes 2026 dashboard

A small React dashboard for the "Minutes 2026" sheet of the Berlin Sacred Harp
minutes. It shows a leaderboard of the songs that leaders call the most, and a
search box for a song, a page number, or a leader. A filter above the list
selects the songs that leaders called, the songs that nobody called, or all
songs in the book.

Stack: React 18 and Vite. No chart library and no UI framework.

## Commands

1. Install the dependencies:

   ```
   npm install
   ```

2. Start the development server:

   ```
   npm run dev
   ```

3. To make the fallback snapshots current, run the sync script:

   ```
   npm run sync
   ```

4. To build the static site into `dist/`, run the build:

   ```
   npm run build
   ```

## How the data arrives

The dashboard reads the sheet live. The browser downloads both sheets as CSV at
page load. The Google export URL answers with the header
`access-control-allow-origin: *`, so the browser accepts the answer. The sheets
must stay readable by "Anyone with the link".

The first sheet holds the minutes. The second sheet is "Song Frequency 2026".
That sheet lists all 590 songs in the book, so it gives the songs that nobody
called.

Two snapshot files, `src/data/minutes-2026.json` and `src/data/song-index.json`,
are the fallback. The dashboard shows the snapshot at the first paint, so the
page needs no network to appear. The live rows replace the snapshot rows when
both downloads are complete. If a download fails, the snapshot stays on screen
and the footer gives the reason.

The footer tells the reader which source the numbers come from. A button in the
footer reads the sheet again.

`src/lib/sheets.js` holds the spreadsheet ID, the two sheet GIDs, and the
download function. The browser and the sync script both use it.
`scripts/sync-minutes.mjs` writes the snapshot files. Run `npm run sync` to make
the fallback current.

## How the rows are cleaned

`src/lib/minutes.js` builds the leaderboard from the raw rows. It applies three
corrections to the source data:

- It skips empty rows and rows where the lookup formula still shows `#N/A`. The
  minutes for 30.04.2026 are one such block, because nobody typed the songs.
- It corrects fill-down damage in the `Date` column. Some rows inside one
  singing carry the same day and month with a later year, such as 02.04.2027 and
  02.04.2028. The year moves back to the year of the minutes when the day and
  the month match a real singing day.
- It counts a song by page and title together, so 38b and 38t stay separate
  songs.

The dashboard counts the calls itself. It takes the page and the title from the
song list, and not the `Frequency` column of that sheet. The two counts agree:
636 calls, 315 songs with a call, and 275 songs with no call.

A song with no call gets no bar. The "Called" list runs by the number of calls,
and it shows the rank of each song. The "Never called" list and the "All songs"
list run in book order, from page 26 to page 575. These two lists show no rank.

The footer of the dashboard reports how many rows it skipped and how many dates
it corrected.

## Files

| Path | Content |
|---|---|
| `src/App.jsx` | The dashboard: totals, search box, leaderboard, song detail |
| `src/lib/minutes.js` | Row cleaning, song counts, search match |
| `src/lib/csv.js` | The CSV parser |
| `src/lib/sheets.js` | The sheet IDs and the CSV download |
| `src/lib/useLiveSnapshots.js` | The live read, with the snapshot as fallback |
| `src/data/minutes-2026.json` | The fallback snapshot of the minutes |
| `src/data/song-index.json` | The fallback snapshot of all songs in the book |
| `scripts/sync-minutes.mjs` | The script that writes both snapshots |

## Colors

The palette is the validated data-visualization default: blue `#2a78d6` for the
bars on the light surface, and blue `#3987e5` on the dark surface. The dashboard
follows the color scheme of the browser.
