// SPDX-License-Identifier: AGPL-3.0-only
// Typst template for the SP-04 spike. Reads the shared view model. Synthetic only.
#let m = json("out/model.json")
// Long identifiers (digests, URNs) have no natural break points. Allow a line
// break between any two characters so they wrap instead of running off the page.
#let breakable(s) = s.clusters().join(sym.zws)
#set document(title: m.title, author: m.issuing_organization)
#set text(lang: "en", font: "DejaVu Sans", size: 10pt)
#set page(
  paper: "us-letter",
  margin: (top: 2.6cm, bottom: 2.6cm, x: 2cm),
  header: align(center, strong(m.banner)),
  footer: context [
    #align(center, strong(m.banner))
    #v(-0.6em)
    #set text(size: 7pt)
    #align(center)[#breakable(m.guide_id) · revision #m.revision_id · #breakable(m.digest) · page #counter(page).display()]
  ],
  background: if m.draft {
    rotate(-35deg, text(size: 60pt, fill: rgb(200, 0, 0, 60), weight: "bold")[DRAFT / NOT APPROVED])
  },
)

#if m.draft [
  #block(stroke: 1.5pt + red, inset: 8pt, width: 100%)[
    *DRAFT / NOT APPROVED.* This is not an issued guide. It has open review items.
  ]
]

// Running headers and footers are artifacts, which screen readers skip.
// State the overall marking once in tagged body text so it is read aloud.
*Overall classification of this document: #m.banner*

= #m.title

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt,
  table.header([*Field*], [*Value*]),
  [Guide ID], [#breakable(m.guide_id)],
  [Revision], [#m.revision_id],
  [Payload digest], [#text(font: "DejaVu Sans Mono", size: 8.5pt, breakable(m.digest))],
  [Issuing organization], [#m.issuing_organization],
  [Original classification authority], [#m.oca],
  [Point of contact], [#m.poc],
  [Issued], [#m.issued],
  [Next review due], [#m.next_review_due],
)

== Introduction
#m.introduction

== Open review items
#for f in m.open_findings [- #f]

#for s in m.sections [
  == #s.title
  #table(
    // Fixed widths: an `auto` column grows to fit its longest cell, which
    // pushed later columns off the page when a level range had long text.
    columns: (4.8em, 2fr, 4.5em, 1.4fr, 1.4fr),
    stroke: 0.4pt,
    table.header([*Portion*], [*Information*], [*Level*], [*Reason*], [*Declassify*]),
    ..s.entries.map(e => (
      [#e.portion],
      [#e.description
        #if e.level_conditions != none [ \ _Level depends on conditions:_ #e.level_conditions]
        #if e.kind == "compilation" [ \ _Compilation of #e.references when: #e.condition _]
        #if e.controls != "None" [ \ Controls: #e.controls]],
      [#e.level_short],
      [#e.reason],
      [#e.declassification],
    )).flatten()
  )
]
