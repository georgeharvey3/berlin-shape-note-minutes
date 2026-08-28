# Berlin singings — minutes dashboard

A small React dashboard for the shared minutes of the Berlin singings. It shows
a leaderboard of the songs that leaders call the most, and a search box for a
song, a page number, or a leader.

The singers sing from two books. A tab at the top of the page selects the book:

| Tab | Book | Editions | Songs |
|---|---|---|---|
| `Sacred Harp` | The Sacred Harp | 1991 and 2025 | 667 |
| `Shenandoah Harmony` | The Shenandoah Harmony | one | 469 |

Each book has its own Google Sheet, and each tab has its own dashboard. The two
dashboards have the same layout. The tab of the Sacred Harp adds a filter for
the edition, because that book has two editions.

Every tab reads six years of minutes, from 2021 to 2026. A filter above the
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

The dashboard reads the sheets live. The browser downloads 15 sheets as CSV at
page load: seven sheets for the Shenandoah Harmony and eight for the Sacred
Harp. Each book gives one sheet of minutes for each year, and one sheet for each
edition of the book. The Google export URL answers with the header
`access-control-allow-origin: *`, so the browser accepts the answer. The sheets
must stay readable by "Anyone with the link".

The browser reads both books at page load, so a click on a tab needs no new
download.

One snapshot file for each sheet, in `src/data/<book>/`, is the fallback. The
dashboard shows the snapshots at the first paint, so the page needs no network
to appear. Each sheet stands on its own. A sheet that answers gives live rows. A
sheet that fails keeps its snapshot rows, and the footer of its book names it.

The footer tells the reader which source the numbers come from. A button in the
footer reads the sheets again.

`src/lib/sheets.js` holds the two books, their spreadsheet IDs, their sheet
GIDs, and the download function. The browser and the sync script both use it.
`scripts/sync-minutes.mjs` writes the snapshot files. Run `npm run sync` to make
the fallback current.

The snapshot files hold the rows as arrays, with the column names in `columns`.
The bundle holds 15 snapshots, so this shape keeps the bundle small. `toObjects`
in `src/lib/sheets.js` turns the rows back into objects.

`src/App.jsx` reads the snapshot files with `import.meta.glob`, so a new book
needs no new import. Add the book to `src/lib/sheets.js` and run `npm run sync`.

## The two editions of the Sacred Harp

The singers changed the edition in September 2025. The first singing with the
new book is 25.09.2025. The 1991 edition has 554 songs on pages 26 to 573. The
2025 edition has 590 songs on pages 26 to 575.

The "Song Frequency 1991" sheet holds three rows that no edition has: pages 24t,
24b and 25. The music of the 1991 edition starts on page 26. The field
`excludedPages` of that edition, in `src/lib/sheets.js`, drops these three rows.

The change moves some songs to a new page. "Africa" moves from page 178 to page
178t. A song must stay one song across the two editions, so `src/lib/books.js`
builds a crosswalk between the two "Song Frequency" sheets.

The book gives the list of the songs that changed their page or their title.
The field `changes` of the 2025 edition, in `src/lib/sheets.js`, holds that
list. It has 17 entries:

- Four songs on a new page: "Fellowship" from 330b to 330t, "Southwell" from
  365 to 364, "Sermon on the Mount" from 507 to 508, and "Hebron" from 566 to
  565t.
- Eleven pages that the 2025 edition cuts into a top half and a bottom half.
  The song keeps the number and takes a "t" or a "b": 27t "Bethel", 178t
  "Africa", 347t "Christian's Farewell", 414b "Parting Friend", 420b "Bishop",
  423t "Grantville", 452b "Martin", 497t "Natick", 499b "At Rest", 501b
  "O'Leary", and 565b "The Hill of Zion".
- Two songs with the original title again: 227 "Ode of Life's Journey" and 143
  "Pleyel's Hymn Second".

The list is complete. A song that the list does not name keeps its page and its
title. Two songs with the same title on two different pages are therefore two
songs, and not one song that moved. The 2025 edition has "Imandra New" on 45b
and "Imandra" on 525, and these are two songs.

The match runs in four passes, from the strictest to the loosest:

1. The change list. This pass matches 17 songs.
2. Same page and same title. This pass matches 457 songs.
3. Same page, and the same title after the note in brackets goes out. The 1991
   edition writes "My Home (First)" and the 2025 edition drops such a note. The
   sheets of today give this pass no song, but a later edit of a sheet can.
4. Same page number and a similar title. This pass catches a new spelling, such
   as "Carmathen" to "Carmarthen" on page 473. A title with a whole word more
   names another song, so this pass leaves such a pair alone. This pass matches
   3 songs.

The result is 667 songs: 477 songs in both editions, 113 new songs, and 77 songs
that went out. 15 of the matched songs have a new page.

The dashboard counts the calls of the two editions under one song. "Africa" has
one row with 16 calls, from 2021 to 2026. The row shows the page of the 2025
edition and a tag with the old page. The detail of the song names both pages.
A song with a new title keeps one row too. The detail of that song names the
title of the 1991 edition, and the search box finds the song under both titles.

Each singing day carries its own edition, so the dashboard needs no cut-off
date. `assignEditions` reads the page and the title of each call. A page and
title that only one edition has names that edition. A day with no such call
takes the edition of the day before it, because the change of the edition runs
one way.

## The one edition of the Shenandoah Harmony

The Shenandoah Harmony has one edition. Its tab shows no filter for the edition,
and each page carries one number. The book has 469 songs. Its music runs from
page 1 to page 457, and one song sits in the front matter on page viii.
`pageOrder` in `src/lib/books.js` reads that roman page number and sorts it
before page 1.

The "Song Frequency" sheet of this book also names the source book and the mode
of each song. The detail of a song shows both, in the line that the Sacred Harp
uses for its two editions.

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
- The "Minutes 2021" sheet of the Sacred Harp has no header over its first
  column. A row of that sheet takes its position in the sheet as the order of
  entry.

The two books give the column of the leaders two names. The Sacred Harp sheets
write "Name(s) of Leaders" and the Shenandoah sheets write "Name(s)". The lookup
matches a prefix of the header, so `Name(s)` finds both.

A few calls name a song that the book does not have. The Sacred Harp has five
such calls, four carols and one transcription. The Shenandoah Harmony has four.
These calls keep a row of their own with a tag: "not in either edition" in the
Sacred Harp, and "not in the book" in the Shenandoah Harmony.

A song with no call gets no bar. The "Called" list runs by the number of calls,
and it shows the rank of each song. The "Never called" list and the "All songs"
list run in book order. These two lists show no rank.

The set of songs behind the two lists follows the year filter. In the Sacred
Harp the years 2021 to 2024 use the 1991 edition only, so the book has 554
songs. The year 2026 uses the 2025 edition only, so the book has 590 songs. A
selection that crosses the change of the edition gives all 667 songs.

The footer of each tab reports how many rows it skipped and how many dates it
corrected.

## The filter for the edition

This filter belongs to the tab of the Sacred Harp. It is the row "Edition", and
it has six buttons:

| Button | The songs it gives | Count |
|---|---|---|
| `Any` | no restriction | 667 |
| `1991 edition` | the songs of the 1991 edition | 554 |
| `2025 edition` | the songs of the 2025 edition | 590 |
| `Both editions` | the songs of both editions | 477 |
| `New in 2025` | the songs that the 2025 edition added | 113 |
| `Out in 2025` | the songs that went out | 77 |

The counts above are the counts for all six years. The year filter cuts them.
The year 2026 with the button `1991 edition` gives the 477 songs that survived
the change of the edition.

A button turns off when the year filter takes away the only edition that has its
songs. The years 2021 to 2024 use the 1991 edition only, so `New in 2025` turns
off in those years. The choice then falls back to `Any`. It comes back when the
reader selects a year with that edition again.

The three filters work together. The bars follow the year filter and the edition
filter, so the longest bar of the set on screen is always full. A search does not
change the length of a bar.

The list "All songs" with the button `Any` gives 672 songs: the 667 songs of the
two editions, and the five songs that neither edition has. The same list in the
Shenandoah Harmony gives 473 songs: the 469 songs of the book, and the four
songs that the book does not have.

## Files

| Path | Content |
|---|---|
| `src/App.jsx` | The tab of each book, and the shared live read |
| `src/BookDashboard.jsx` | The dashboard of one book: filters, totals, search box, leaderboard, song detail |
| `src/lib/books.js` | The songs of one book and the crosswalk between two editions |
| `src/lib/minutes.js` | Row cleaning, edition of each day, song counts, search match |
| `src/lib/csv.js` | The CSV parser |
| `src/lib/sheets.js` | The two books, the sheet IDs, the CSV download, and the row reader |
| `src/lib/useLiveSnapshots.js` | The live read, with the snapshots as fallback |
| `src/data/<book>/minutes-20NN.json` | The fallback snapshot of one year of minutes |
| `src/data/sacred-harp/book-1991.json` | The fallback snapshot of the 1991 edition |
| `src/data/sacred-harp/book-2025.json` | The fallback snapshot of the 2025 edition |
| `src/data/shenandoah/book-shenandoah.json` | The fallback snapshot of the Shenandoah Harmony |
| `scripts/sync-minutes.mjs` | The script that writes all snapshots |

## Colors

The palette is the validated data-visualization default: blue `#2a78d6` for the
bars on the light surface, and blue `#3987e5` on the dark surface. The dashboard
follows the color scheme of the browser.
