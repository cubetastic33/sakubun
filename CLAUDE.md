# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sakubun is a web app for Japanese learners: it stores which kanji the user knows and serves practice sentences (from a ~130K-sentence Tatoeba corpus) that use *only those kanji*. Backend is Rust/Rocket; frontend is server-rendered Tera templates plus vanilla JS.

## Commands

```sh
cargo build            # build (CI runs exactly this; there are no tests)
cargo run              # run the server on http://127.0.0.1:8000
sass static/styles/:static/styles/ --style compressed   # compile .scss → .css (required after editing styles)
```

Running the server requires a `.env` file (loaded via dotenv) with `SECRET_KEY`, `DATABASE_URL` (Postgres), `ADMIN_HASH` (argon2 hash of the admin password), and `HEALTH_URL`. `PORT` and `ADDRESS` are optional (default 8000 / 127.0.0.1). Streak reminder push notifications additionally need `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` (base64url, generated once with `npx web-push generate-vapid-keys`), and `VAPID_SUBJECT` (a `mailto:` URL); without them the feature is disabled but everything else works. `PUSH_TICK_SECS` optionally shortens the reminder check interval (default 900) for testing.

There is no test suite and no lint config. The Dockerfile reproduces the full build (nightly Rust + Dart Sass).

## Architecture

### Data lives in flat files, not the database

- `sentences.csv` (repo root, tab-separated): `id, japanese, english, kanji-in-sentence`. Quiz/essay generation reads and shuffles this file on every request (`src/actions.rs`).
- `kana_sentences.txt`: `id, kana reading` — the expected answer for each sentence.
- `wanikani.txt`, `rtk.txt`, `jlpt.txt`, `kanken.txt`: kanji orderings used by the "import known kanji" feature.

The Postgres database (`admindb` pool, attached in `src/main.rs`) holds three tables — `reports` and `overrides` (schema documented in a comment at the top of `src/admin.rs`) and `push_subscriptions` (schema in `src/notifications.rs`). The user's known-kanji list is stored client-side in localStorage and posted with every quiz request as the `QuizSettings` form. (Signed-in users additionally sync kanji/streak data to Supabase from the frontend; the Rocket backend has no user auth.)

### The report → override pipeline

Users report bad sentences/readings from the quiz (`POST /report`). An admin (authed by comparing an argon2-verified private cookie against `ADMIN_HASH`) reviews reports at `/admin` and creates overrides that correct a sentence's `question`, `translation`, or `reading`. `fill_sentences` in `src/actions.rs` is the central function that layers data onto sentences pulled from the CSV: first readings from `kana_sentences.txt`, then overrides from the database. For readings, `primary_value = true` replaces the reading while `false` adds an additional accepted answer (comma-separated). The `Sentence` trait exists so this same function works on both quiz arrays and admin report structs.

### Source layout

- `src/main.rs` — all route handlers, Rocket setup, `FormatError` helper trait (converts any error into a `(Status, String)` response).
- `src/actions.rs` — sentence selection for quiz and essay, `fill_sentences` override machinery.
- `src/admin.rs` — report/override CRUD; all admin mutation routes re-check the `admin_hash` cookie.
- `src/kanji_import.rs` — extracting known kanji from uploaded Anki decks (zip containing a sqlite db, possibly zstd-compressed for scheduler v3), the WaniKani API, or the ordered `.txt` lists. Anki uploads write a temp `<uuid>.db` file that must be cleaned up on every error path (`error_cleanup`).
- `src/notifications.rs` — streak reminder push notifications. Signed-in users opt in on the quiz page; the client computes its streak (`compute_streaks` in `static/scripts/streaks.js`) and writes it with its Web Push subscription **directly to the `push_subscriptions` table via the Supabase client** (`static/scripts/push.js`) — RLS restricts rows to the logged-in user and fills `user_id` via its `auth.uid()` default. The Rust side only runs a background send loop (spawned at Rocket liftoff, bypasses RLS as table owner) that pushes a reminder around 7pm local time when a 2+ day streak is at risk.

### Frontend

Answer checking happens client-side: Kuroshiro (with the kuromoji dictionary shipped in `static/dict/`) generates readings, WanaKana provides a kana IME, and `static/scripts/quiz.js` diffs the user's answer against accepted readings. The app is a PWA (`static/pwa/service-worker.js`) with an offline page. Each page has a matching `.scss`/`.js` pair in `static/styles/` and `static/scripts/`.

### scripts/

One-off data-generation scripts (Rust and Python) used to build the corpus and reading files — not compiled into or used by the web app. The Python transcription scripts (`sudachi_transcribe.py`, `unidic_transcribe.py`) regenerate `kana_sentences.txt`; recent work has focused on fixing incorrect auto-generated readings.
