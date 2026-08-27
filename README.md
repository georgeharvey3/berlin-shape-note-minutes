# Berlin Sacred Harp — minutes dashboard

A small React dashboard for the shared minutes of the Berlin Sacred Harp
singings. It shows a leaderboard of the songs that leaders call the most, and a
search box for a song, a page number, or a leader.

The dashboard reads six years of minutes, from 2021 to 2026. A filter above the
totals selects the years. Every year counts by default. A second filter selects
the songs that leaders called, the songs that nobody called, or all songs in the
book.

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

The dashboard reads the sheets live. The browser downloads eight sheets as CSV
at page load: one sheet of minutes for each year, and one sheet for each edition
of the book. The Google export URL answers with the header
`access-control-allow-origin: *`, so the browser accepts the answer. The sheets
must stay readable by "Anyone with the link".

One snapshot file for each sheet, in `src/data/`, is the fallback. The dashboard
shows the snapshots at the first paint, so the page needs no network to appear.
Each sheet stands on its own. A sheet that answers gives live rows. A sheet that
fails keeps its snapshot rows, and the footer names it.

The footer tells the reader which source the numbers come from. A button in the
footer reads the sheets again.

`src/lib/sheets.js` holds the spreadsheet ID, the sheet GIDs, and the download
function. The browser and the sync script both use it.
`scripts/sync-minutes.mjs` writes the snapshot files. Run `npm run sync` to make
the fallback current.

The snapshot files hold the rows as arrays, with the column names in `columns`.
The bundle holds eight snapshots, so this shape keeps the bundle small.
`toObjects` in `src/lib/sheets.js` turns the rows back into objects.

## The two editions of the book

The singers changed the book in September 2025. The first singing with the new
book is 25.09.2025. The 1991 revision has 557 songs on pages 24 to 573. The 2025
revision has 590 songs on pages 26 to 575.

The change moves some songs to a new page. "Africa" moves from page 178 to page
178t. A song must stay one song across the two editions, so `src/lib/books.js`
builds a crosswalk between the two "Song Frequency" sheets. The match runs in
five passes, from the strictest to the loosest:

1. Same page and same title. This pass matches 457 songs.
2. The title appears once in the rest of the other edition. This pass catches a
   song that moved to a new page, such as "Africa".
3. The title appears more than once. The nearest page wins. The book has eleven
   such titles, among them "Exhortation" and "Parting Friends".
4. Same page number and a similar title. This pass catches a new spelling, such
   as "Carmathen" to "Carmarthen" on page 473.
5. A very similar title on any page: "Kingwood" on 266 to "Kingswood" on 323b.

The result is 666 songs: 481 songs in both editions, 109 new songs, and 76 songs
that went out. 19 of the matched songs have a new page number.

The dashboard counts the calls of the two editions under one song. "Africa" has
one row with 16 calls, from 2021 to 2026. The row shows the page of the 2025
revision and a tag with the old page. The detail of the song names both pages.

Each singing day carries its own edition, so the dashboard needs no cut-off
date. `assignEditions` reads the page and the title of each call. A page and
title that only one edition has names that edition. A day with no such call
takes the edition of the day before it, because the change of the book runs one
way.

## How the rows are cleaned

`src/lib/minutes.js` builds the leaderboard from the raw rows. It applies four
corrections to the source data:

- It skips empty rows and rows where the lookup formula still shows `#N/A`.
- The minutes up to 2025 hold US dates (`m/d/yyyy`). The minutes of 2026 hold
  German dates (`dd.mm.yyyy`). The separator tells the two formats apart, so no
  sheet needs a setting.
- It corrects fill-down damage in the `Date` column. Some rows inside one
  singing carry the same day and month with a later year, such as 02.04.2027 and
  02.04.2028. The year moves back to the year of the minutes when the day and
  the month match a real singing day. A row that matches no singing day goes out
  with the dropped rows.
- The "Minutes 2021" sheet has no header over its first column. A row of that
  sheet takes its position in the sheet as the order of entry.

Five calls name a song that neither edition has. Four of them are carols, and
one is a transcription. These calls keep a row of their own with the tag "not in
the book".

A song with no call gets no bar. The "Called" list runs by the number of calls,
and it shows the rank of each song. The "Never called" list and the "All songs"
list run in book order. These two lists show no rank.

The set of songs behind the two lists follows the year filter. The years 2021 to
2024 use the 1991 revision only, so the book has 557 songs. The year 2026 uses
the 2025 revision only, so the book has 590 songs. A selection that crosses the
change of the book gives all 666 songs.

The footer of the dashboard reports how many rows it skipped and how many dates
it corrected.

## Files

| Path | Content |
|---|---|
| `src/App.jsx` | The dashboard: year filter, totals, search box, leaderboard, song detail |
| `src/lib/books.js` | The two editions of the book and the crosswalk between them |
| `src/lib/minutes.js` | Row cleaning, edition of each day, song counts, search match |
| `src/lib/csv.js` | The CSV parser |
| `src/lib/sheets.js` | The sheet IDs, the CSV download, and the row reader |
| `src/lib/useLiveSnapshots.js` | The live read, with the snapshots as fallback |
| `src/data/minutes-20NN.json` | The fallback snapshot of one year of minutes |
| `src/data/book-1991.json` | The fallback snapshot of the 1991 revision |
| `src/data/book-2025.json` | The fallback snapshot of the 2025 revision |
| `scripts/sync-minutes.mjs` | The script that writes all snapshots |

## Colors

The palette is the validated data-visualization default: blue `#2a78d6` for the
bars on the light surface, and blue `#3987e5` on the dark surface. The dashboard
follows the color scheme of the browser.
