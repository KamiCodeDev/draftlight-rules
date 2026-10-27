# draftlight-rules

The public rules pack for the Draftlight browser extension. This repo holds **data only**. The extension source lives elsewhere.

Once a day the `algo-sync` workflow does three things:
1. It reads the published defaults from [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm): ranking weights, filter thresholds and label rules.
2. It validates them against the pack schema.
3. It publishes `rules-pack.json` and `changes.json` to GitHub Pages.

The extension downloads these two JSON files and nothing else. If upstream makes a change the extractor doesn't recognise, the workflow opens an issue and sets `unreviewedChange` in the pack, so nothing is silently reinterpreted.

The values are the **published code defaults**. X's live configuration can differ.

> Generated from the Draftlight repo by `scripts/export-rules-repo.mjs`; edit there, not here.

## Run locally

```sh
npm ci
npm test
npm run sync   # writes site/rules-pack.json and site/changes.json
```

## Licensing

`tests/fixtures/algo/*` are unmodified copies of xai-org/x-algorithm sources. The values in `src/core/rules/bundled-pack.json` and in the published pack are extracted from that repository. All of that material is licensed under the Apache License 2.0, and its full text is in `licenses/x-algorithm-LICENSE.txt`.

Draftlight is not affiliated with or endorsed by X Corp. or xAI. "X" is a trademark of X Corp.
