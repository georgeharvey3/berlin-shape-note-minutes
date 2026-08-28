// The link from a song of the dashboard to the page of that song on the
// Sacred Harp Bremen website.
//
// Each book has its own site, and the Sacred Harp has one site for each
// edition: the main site carries the 2025 edition, and a second site keeps the
// songs that only the 1991 edition has. The field `site` of each edition, in
// `sheets.js`, holds the address.
//
// The path of a page is the page and the title of the song, as one slug:
// "37t Ester" gives "/37t-ester/". The slug rule is the rule of WordPress,
// because the sites run on WordPress.

// The slug of one piece of text, with the rule of `sanitize_title_with_dashes`
// in WordPress. A dot becomes a dash. Every other character that is not a
// letter, a digit, a space, an underscore or a dash goes out, and it leaves no
// dash behind: "O’Leary" gives "oleary" and "Christian's Farewell" gives
// "christians-farewell". A space becomes a dash.
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// The name of the tune alone. The "Song Frequency" sheet of the Shenandoah
// Harmony adds the first line of the text to 39 of its 469 titles, after a
// dash with a space on each side: "Lisbon - Farewell, dear brethren of the
// Lord". The website names the tune only, so the first line goes out. A
// hyphen inside a word stays, because it carries no space: "Ninety-Third
// Psalm" keeps its hyphen.
export function tuneName(title) {
  return title.split(' - ')[0].trim()
}

// The path of one song on the site of its edition.
export function songPath(page, title) {
  const slug = slugify(`${page} ${tuneName(title)}`)
  return slug === '' ? null : `/${slug}/`
}

/**
 * The address of one song on the Sacred Harp Bremen website, or null.
 *
 * `book` comes from `buildBook`. `song` is a row of the leaderboard. The
 * search runs from the newest edition to the oldest, and it takes the first
 * edition that has the song and has a site. A song of both editions of the
 * Sacred Harp therefore links to the main site, and a song that went out in
 * 2025 links to the site of the 1991 edition.
 *
 * A song that no edition has carries no page on any site, so it gets no link.
 */
export function bremenUrl(book, song) {
  const sites = new Map(book.definition.editions.map((edition) => [edition.id, edition.site]))
  for (const editionId of [...book.editionIds].reverse()) {
    const inEdition = song.editions?.[editionId]
    const site = sites.get(editionId)
    if (!inEdition || !site) continue
    const path = songPath(inEdition.page, inEdition.title)
    if (path) return `${site}${path}`
  }
  return null
}
