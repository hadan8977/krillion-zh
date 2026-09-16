# Krillion Chinese — 万里挑一

A standalone Chinese adaptation of [Krillion](https://krillion.io/), deployed as
static assets and Node API functions on Vercel. Optional Supabase storage powers
anonymous answer records, player feedback, and automatic answer-bank updates.
The game also runs locally without cloud credentials.

## Run

Requires Node.js 22.12 or newer. From this directory:

```sh
npm ci
npm run dev
```

Open **http://localhost:3210**. Set `PORT` to use a different port. The server binds
to the local computer only. Answer matching and animation run in the browser.
The local server loads `.env.local` when present and serves the same API handlers
as Vercel. Without cloud configuration, play and local saves still work; feedback
stays queued locally until it can be sent.

```sh
npm test
```

Tests cover Chinese matching, category boundaries, selection, scoring, recovery,
automatic updates, HTTP authentication and collection, and actual Postgres SQL
using PGlite. The Supabase HTTP transport in tests is a local adapter, so these
tests do not establish that a hosted project has been configured. No frontend
build step is needed; Vercel bundles the API functions.

## Cloud setup on the deployment machine

Use a **dedicated Supabase project for this game**. GitHub pushes already trigger
the connected Vercel deployment; database setup and server secrets are separate.
This repository does not contain any account credentials.

1. Create and connect Supabase through the Vercel project's Storage/Marketplace
   page, or create the project directly in Supabase. The
   [official integration guide](https://supabase.com/docs/guides/integrations/vercel-marketplace)
   describes both existing-project and new-project connections.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in that project's SQL Editor.
   It creates the `kr_*` tables and functions, enables RLS, and restricts raw data
   and write operations to the server's `service_role`. It can be rerun. The first
   API request seeds the bundled answer bank without overwriting an existing release.
3. Configure these **server-only** variables in the game's Vercel project:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | The dedicated project's HTTPS API URL |
   | `SUPABASE_SECRET_KEY` | Its `sb_secret_...` API key; the legacy `SUPABASE_SERVICE_ROLE_KEY` is also supported |
   | `CRON_SECRET` | A generated random secret of at least 32 characters |

   Use the actual unprefixed names above even if the Marketplace integration
   supplies additional variables. Do not use a publishable/anon key for the server,
   or add `NEXT_PUBLIC_`/`VITE_` to a secret. For local integration testing, copy
   [`.env.example`](.env.example) to ignored `.env.local` and fill in the values.
   Account-wide Supabase/Vercel access tokens are not required at runtime.
4. Redeploy the GitHub revision after saving the environment variables. Keep
   Vercel's framework preset as **Other**; `vercel.json` defines the existing static
   asset allowlist, Node functions, API rewrites, and daily cron. The database
   schema must be applied before enabling the configured API.

`GET /api/bank` returns `online: true` only when server configuration is present
and the database can supply the bank. Play a round and submit feedback, then check
`kr_attempts` and `kr_feedback` in Supabase's Table Editor to verify hosted writes.
No public page exposes raw submissions or player identifiers.

Vercel calls `/api/refresh` at `0 16 * * *` (UTC), around midnight in Beijing.
Its [cron scheduler](https://vercel.com/docs/cron-jobs/manage-cron-jobs) sends
`Authorization: Bearer <CRON_SECRET>` automatically. On Hobby, a daily invocation
can occur anywhere within that hour; see the
[current limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
The function can also be invoked by a deployment script with that server secret.
Repeated or competing runs cannot publish twice for the same Beijing date.

After setup, collection, score recalculation, alias learning, consensus-based
additions, and publication run without an administrator or AI. Ordinary data
updates do not need a Git commit or redeployment. Git changes are still needed
when intentionally changing the category definitions or the update policy.

## Automatic data and scoring rules

- **Records:** submissions include question, input, match/unknown/timeout outcome,
  elapsed time, bank version, and whether answers were already shown. Feedback
  records its category, answer, and explanation. The API derives questions and
  adjudicates inputs itself; it does not trust a client-supplied score.
- **Anonymous identity:** a signed, HttpOnly cookie contains a random browser ID
  lasting 30 days. No account, name, email, or raw IP is requested or stored in the
  game database. A daily HMAC of the network address supports rate limits and
  duplicate-vote suppression. Likely contact details and credentials are redacted
  from submissions. Infrastructure providers have their own request logs.
- **Sampling:** scores use the last 30 days, at most one first attempt per browser
  and question. Retries, timeouts, and known answer exposures are excluded; unknown
  first answers remain in the denominator. A question needs 50 eligible samples.
- **Weights:** observed frequencies are smoothed with a 30-sample prior based on
  the current tiers. Scores normally move at most one tier each day; one answer
  remains the 100-point gem. The special 15-point wordplay tier stays curated.
- **Aliases:** deterministic wrappers such as “一架钢琴” can map to an existing
  answer after three distinct submitters across two dates. Similar spelling alone
  never establishes an alias.
- **New answers:** unknown guesses and missing-answer feedback form candidates.
  Admission needs five distinct submitters across two dates, at least 15 votes,
  at least 85% approval, and a Wilson 95% lower bound of at least 60%. Reviewers
  must have correctly answered three different questions and cannot review their
  own suggestion. Each browser votes once per candidate; the same network can
  contribute at most one vote per candidate per UTC day. Players can skip items
  they do not know. At most three new answers per question are admitted daily.
- **Other feedback:** incorrect-answer reports, score complaints, and general
  suggestions are recorded. They do not directly override scores or remove answers;
  score changes come from samples, and additions follow the rules above.
- **Versions:** updates create immutable `kr_banks` snapshots and a change log.
  New games fetch the latest snapshot. An active dive and today's existing daily
  attempt keep their opening bank and scores, including after reload. Question
  selection uses the base category version so score changes do not reshuffle a day.

The executable thresholds live in `backend/automation.js`; SQL deduplication,
review tickets, and atomic publication live in `supabase/schema.sql`. Inspect
`kr_banks.changes` for the evidence behind a release, `kr_candidates`/`kr_votes` for
community inputs, and `kr_channels` for the current version and refresh date.
Raw attempts, feedback, votes, and bank snapshots are retained; aggregation uses
a 30-day window. Only expired rate-limit buckets and review tickets are cleaned up.

These are browser-level samples, not verified unique people or a representative
survey. Clearing cookies and coordinated voting cannot be completely prevented
without stronger identity checks. Community agreement can also be wrong: the
system does not infer semantic truth or guarantee an exhaustive answer bank.

## Implemented

- Seven questions, 25 seconds per question, one accepted answer per round.
- Original score tiers: 10 / 15 / 30 / 60 / 85 / 100; ten metres per point.
- Daily selection stays fixed for the same date and bank version, and changes at
  midnight in Asia/Shanghai. Completed daily dives remain viewable. Refreshing
  or hiding the tab does not reset an active timer.
- Free play and both themed pools use a fresh random seed on each new dive.
  Questions are unique within a dive; some may recur across separate dives.
- The previous 14 daily sets, local history,
  spoiler-free text sharing, settings, and two mascot colours.
- Pixel ocean backgrounds, camera descent, sea life, particles, CRT scanlines,
  depth ruler, score effects, and synthesized Web Audio cues.
- Responsive Chinese UI, a local Chinese pixel font, IME composition handling,
  reduced motion, and a higher-contrast text setting.

This is an independently implemented adaptation. Animation curves, composition,
and synthesized sound have not been demonstrated to be identical in every state
to the reference. Accounts, purchases, friends, global rankings, and cross-device
sync are not implemented. Browser storage provides local continuity, not a
tamper-resistant competition system.

## Chinese answer quality

The bank in `src/questions.js` contains **60 everyday categories, 3,825 answer
entries, and 1,431 explicit aliases** (counted per prompt). Topics cover food and
drinks, home, everyday interests, and outdoor life. Questions 13, 28, and 37 now
ask for instruments, nuts or edible seeds, and shoe types. Subjective attributes
such as crunchy, soft, or round, and scenarios such as bedside objects, gifts,
or waiting activities have been replaced with named categories and explicit
inclusion rules. The themed pools are “家里的小事” (food and home) and
“出门走走” (daily life and outdoors).

These categories have curated accepted answers, not exhaustive lists. Narrow
categories have fewer entries; no minimum count is imposed by adding dubious
examples. Each prompt states its scope before submission. The answer browser
numbers all 60 questions and shows their answers and aliases. Optional catalogue
and educational links illustrate some category members; they do not verify the
whole list or establish rarity.

The content review checks all 60 scopes, removes out-of-scope examples, merges
synonyms, and keeps distinct objects separate. For example, sunflower and
Portulaca grandiflora are separate answers, while regional mushroom names and
alternative names for the same card game resolve to one score. Tests exercise
accepted examples and nearby exclusions for every category, all declared aliases,
and fresh-seed versus daily selection behavior.

`src/answer-rules.js` and `src/game.js` share normalization and adjudication
between the browser and API:

- OpenCC converts traditional Chinese; NFKC handles compatibility forms.
- Known aliases resolve to one canonical answer and score.
- Internal punctuation remains significant. Multiple guesses cannot be combined
  into a valid answer.
- A unique, one-character substitution in a name of at least three characters
  may produce a suggestion. Suggestions require editing and resubmission; they
  never award points automatically.
- An unmatched input is described as unrecognized, not proven false. Players can
  retry while time remains and submit a correction with a reference.

**Bundled rarity is an initial editorial assignment.** Connected deployments
adjust it only after the sampling threshold is reached. There has been no
independent representative study of Chinese player familiarity. The 60 categories
will recur during sustained daily play; the game invents no population counts or
percentiles.

For content expansion, preserve a precise inclusion rule, canonical identities,
explicit aliases, relevant references where available, and one designated gem per
prompt. Add regressions for genuine omissions and false positives. Changes to
bundled content require incrementing `BANK_VERSION`; cloud releases append their
own revision without changing the category seed. Active games, daily results, and
local history use versioned storage keys. Old records remain in the browser;
settings, correction exports, and pending cloud submissions remain shared.

Corrections are stored under `krillion-zh:corrections` and can be downloaded from
the Chinese question-bank dialog. Connected feedback is sent to this game's
database; failed requests remain queued for retry, with a local-only status shown
until the server confirms receipt.

## Assets and provenance

The following reference artwork was downloaded from the public Krillion site on
2026-09-15 for this requested local adaptation. It is third-party artwork and is
not licensed by this repository. The downloaded responses did not include a
separate artwork license.

| Local files | Original location |
| --- | --- |
| `assets/bg-{sky,top,mid,trench}.webp` | `https://krillion.io/gen/optimized/v1/` |
| `assets/{plankton,tooclever,schooler,rare,deepcut,krillion,krillion-gold}.png` | `https://krillion.io/tiers/` |

The original site also synthesizes its sound. `src/audio.js` contains this
adaptation's Web Audio implementation; no recorded audio or original JavaScript
bundle is redistributed.

The Chinese font is [Fusion Pixel](https://github.com/TakWolf/fusion-pixel-font),
12px proportional Simplified Chinese, release **2026.09.01**. Its SIL Open Font
License and upstream font notices are included under `assets/FONT-LICENSE*`.
OpenCC-JS is pinned in `package-lock.json` and retains its package license notices.
