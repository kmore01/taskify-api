# Product

<!-- impeccable:product-schema 1 -->

Every fact below is inferred from the repository (AGENTS.md, TODO.md, `app/static/`), not
confirmed in an interview: the owner delegated the redesign with full freedom.

## Platform

web

## Users

(Inferred) One person planning their own events from a desktop browser, sometimes a phone.
Spanish speaker. Each account sees only its own events.

## Product Purpose

(Inferred) Planifier keeps a personal list of events and a calendar of them: create, edit,
move, repeat, categorize, search, and exchange them as `.ics`. Success is knowing what comes
next and placing a new event in a few seconds.

## Positioning

(Inferred) A small self-hosted planner: FastAPI + MongoDB with a no-build vanilla-JS frontend.
An event is finished when its `end` passes; there is no manual completion.

## Operating Context

Two work areas: the event list (pending first, finished collapsed) and the calendar (day, week,
month, year; drag, resize, click-to-create). Keyboard shortcuts: `C` new event, `/` search.

## Capabilities and Constraints

- Event fields: title, description, start, end, all-day, color, category (free text), location,
  link, repeat (`none|daily|weekly|monthly|yearly`).
- Eleven fixed event colors, chosen per event; they carry meaning and must stay distinguishable.
- Frontend is ES modules served from `/static` with no build step and no dependencies.
- Optional sound and motion effects, with a mute toggle; browser reminders only while the tab is open.
- UI text is Spanish; code comments are English; no emojis.

## Brand Commitments

Name: Planifier. No logo, palette or typeface is binding.

## Evidence on Hand

No screenshots, testimonials, metrics or marketing copy exist. Do not fabricate any.

## Product Principles

- The next event is the first thing read.
- Familiar calendar controls; nothing to learn.
- Event colors belong to the user; the interface stays out of their way.
- Works without a build step.

## Accessibility & Inclusion

(Inferred from existing code) Keyboard operable, visible focus, `prefers-reduced-motion`
respected, light and dark schemes.
