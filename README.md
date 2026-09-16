# Krillion Chinese — 万里挑一

A standalone, local Chinese adaptation of [Krillion](https://krillion.io/).
It has its own server, dependencies, storage keys, and UI. It runs independently
and does not require a database, cloud account, or environment file.

## Run

Requires Node.js 22.12 or newer. From this directory:

```sh
npm ci
npm run dev
```

Open **http://localhost:3210**. Set `PORT` to use a different port. The server binds
to the local computer only. All game assets and answer matching run locally;
reference links open their original websites. There is no production deployment.

```sh
npm test
```

The targeted Node tests cover the answer bank, Chinese normalization, semantic
boundaries, deterministic daily selection, scoring, deadlines, and save recovery.
No build step is needed.

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

`src/game.js` is the only implementation of normalization and adjudication:

- OpenCC converts traditional Chinese; NFKC handles compatibility forms.
- Known aliases resolve to one canonical answer and score.
- Internal punctuation remains significant. Multiple guesses cannot be combined
  into a valid answer.
- A unique, one-character substitution in a name of at least three characters
  may produce a suggestion. Suggestions require editing and resubmission; they
  never award points automatically.
- An unmatched input is described as unrecognized, not proven false. Players can
  retry while time remains and export a local correction with a reference.

**Rarity is an initial editorial assignment, not measured Chinese familiarity.**
There has been no independent human review or Chinese player calibration study. The current bank is sufficient
to exercise the game but too small for a sustained daily content schedule without
repetition. The UI makes these limits explicit and invents no population counts
or percentiles.

For content expansion, preserve a precise inclusion rule, canonical identities,
explicit aliases, relevant references where available, and one designated gem per prompt. Add regressions
for genuine omissions and false positives. Before treating rarity as validated,
collect consented responses from the intended Chinese-speaking audience, merge
aliases, and compare answer frequencies within each prompt. Human review is still
needed for ambiguous categories and the “too clever” tier. Updating answer content
or tiers requires incrementing `BANK_VERSION`. Active games, daily results, and
history use versioned storage keys. The earlier bank's saved records remain in
the browser without being loaded into the new bank; settings and corrections
remain shared.

Corrections are stored under `krillion-zh:corrections` and can be downloaded from
the Chinese question-bank dialog. Nothing is automatically sent to a maintainer.

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
