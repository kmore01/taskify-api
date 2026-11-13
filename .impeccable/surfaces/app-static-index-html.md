---
version: 1
slug: "app-static-index-html"
primary_target: "app/static/index.html"
related_targets: []
---

# Planifier app shell (app/static/index.html)

Mode: Operate. Audience: one person planning their own events; jobs: read what comes next, add or move an event. Constraints: vanilla ES modules, no build, Spanish UI, light and dark, 11 user-owned event colors.

## Direction contract

THESIS: Planifier's list is a box-office billing (cartelera): every event is an admission ticket whose date stub is read first. Refuses the grey calendar clone with one blue accent and a centered card column.

OWN-WORLD: Petrol-green rail and pale green-grey ground; white ticket stock; marigold yellow reserved for pressable primary actions; event colors tint only stubs and chips. One family, Archivo, condensed width for dates and titles of periods. Perforated stub with two notches is the component signature.

STORY: The visitor reads the nearest dates down the stub column, trusts that finished events fall away on their own, and adds the next one.

FIRST VIEWPORT: Left rail 15rem (brand, Eventos / Calendario, user and toggles at the bottom). Main: h1 "Eventos" with "Nuevo evento" in marigold at its right; a filter row (search, categories, order, import/export); then the ticket column, stub at left 5.25rem with condensed day numeral. Under 860px the rail becomes a top bar with two tabs.

FORM: ticket stubs / cartelera, position 7 of 7 in the grounded list; seed:5d82d885b6a64ecc. Signature interaction: a new ticket drops in and a deleted one tears off sideways (existing fx enter/leave). Raises: action-only saturated color (from the warm consumer app challenger); the calendar grid stays the visible armature (from the Crouwel challenger).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
