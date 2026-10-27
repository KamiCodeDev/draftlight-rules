// Daily algorithm sync (run by .github/workflows/algo-sync.yml, or by hand):
//   node tools/algo-sync/run.ts --out site [--prev-url https://<user>.github.io/<repo>] [--bundle] [--reviewed]
//
// 1. Resolve x-algorithm HEAD and fetch the watched source files at that commit.
// 2. Build the rules pack (pure, build.ts) and diff it against the previous one.
// 3. Write <out>/rules-pack.json and <out>/changes.json (data only, never code).
// 4. If anything structural changed, or a watched logic file changed without
//    any value change, set unreviewedChange and write <out>/issue.md so the
//    workflow opens an issue for a human instead of silently publishing guesses.

import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { parseRulesPack, type RulesPack } from '../../src/core/rules/schema.ts';
import { buildPack, diffPacks, type ChangeEntry, type Sources } from './build.ts';

const REPO = 'xai-org/x-algorithm';
const FILES = {
  homeMixerParams: 'home-mixer/params/param.rs',
  vmRankerParams: 'vm-ranker/params.rs',
  pipeline: 'home-mixer/candidate_pipeline/phoenix_candidate_pipeline.rs',
  config: 'home-mixer/params/config.rs',
  ptosFilter: 'grox/flows/ptos/task_filter.py',
  labelRules: 'safety-label-user-agg/postToUserLabelRules.strato',
} as const;

/** Logic files whose changes may alter what AlgoLens tells users, even if no extracted value moves. */
const WATCHED = [
  'xai-value-model/',
  'home-mixer/scorers/author_cold_start.rs',
  'home-mixer/filters/',
  'home-mixer/candidate_hydrators/vf_candidate_hydrator.rs',
  'home-mixer/models/content_features.rs',
  'visibility-filtering/rules/levels.rs',
  'grox/flows/ptos/task_write_safety_post_annotations_result_sink.py',
  'botmaker-rules/scarecrow/bot/',
  ...Object.values(FILES),
];
const MAX_CHANGES = 300;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function gh<T>(url: string, raw = false): Promise<T> {
  const headers: Record<string, string> = { 'User-Agent': 'algolens-algo-sync', Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (raw ? await res.text() : await res.json()) as T;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'algolens-algo-sync' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const out = arg('out') ?? 'site';
  const prevUrl = arg('prev-url');
  mkdirSync(out, { recursive: true });

  const head = await gh<{ sha: string; commit: { committer: { date: string } } }>(`https://api.github.com/repos/${REPO}/commits/main`);
  const file = (p: string) => gh<string>(`https://api.github.com/repos/${REPO}/contents/${p}?ref=${head.sha}`, true);
  const src: Sources = {
    sha: head.sha,
    commitDate: head.commit.committer.date,
    homeMixerParams: await file(FILES.homeMixerParams),
    vmRankerParams: await file(FILES.vmRankerParams),
    pipeline: await file(FILES.pipeline),
    config: await file(FILES.config),
    ptosFilter: await file(FILES.ptosFilter),
    labelRules: await file(FILES.labelRules),
  };

  const prevRaw = prevUrl
    ? await fetchJson<unknown>(`${prevUrl.replace(/\/$/, '')}/rules-pack.json`)
    : existsSync(path.join(out, 'rules-pack.json'))
      ? JSON.parse(readFileSync(path.join(out, 'rules-pack.json'), 'utf8'))
      : null;
  const prevParsed = prevRaw ? parseRulesPack(prevRaw) : null;
  const prev: RulesPack | null = prevParsed?.ok ? prevParsed.pack : null;
  const prevChanges =
    (prevUrl ? await fetchJson<ChangeEntry[]>(`${prevUrl.replace(/\/$/, '')}/changes.json`) : null) ??
    (existsSync(path.join(out, 'changes.json')) ? (JSON.parse(readFileSync(path.join(out, 'changes.json'), 'utf8')) as ChangeEntry[]) : []);

  if (prev?.sourceSha === head.sha && !process.argv.includes('--reviewed')) {
    // Re-write what is published so a manual redeploy (e.g. privacy page edits) keeps the data files.
    writeFileSync(path.join(out, 'rules-pack.json'), JSON.stringify(prev, null, 2) + '\n');
    writeFileSync(path.join(out, 'changes.json'), JSON.stringify(prevChanges, null, 2) + '\n');
    console.log(`No upstream change (${head.sha.slice(0, 7)}).`);
    writeOutput('changed', 'false');
    return;
  }

  const built = buildPack(src, new Date());
  if (!built.ok) {
    writeFileSync(path.join(out, 'issue.md'), `algo-sync could not build a rules pack for ${REPO}@${head.sha}:\n\n- ${built.errors.join('\n- ')}\n\nThe previous pack stays published.`);
    writeOutput('structural', 'true');
    writeOutput('changed', 'false');
    console.error(built.errors.join('\n'));
    return;
  }
  const pack = built.pack;
  const changes = diffPacks(prev, pack);

  // Logic files that changed between the previous and new commit.
  let touched: string[] = [];
  if (prev) {
    const cmp = await gh<{ files?: { filename: string }[] }>(`https://api.github.com/repos/${REPO}/compare/${prev.sourceSha}...${head.sha}`);
    touched = (cmp.files ?? []).map((f) => f.filename).filter((f) => WATCHED.some((w) => f.startsWith(w)));
  }
  const structural = changes.filter((c) => c.kind === 'structural');
  const logicOnly = touched.filter((f) => !Object.values(FILES).includes(f as (typeof FILES)[keyof typeof FILES]));
  // --reviewed: a human has checked the upstream diff and updated AlgoLens; clear the flag.
  pack.unreviewedChange = process.argv.includes('--reviewed')
    ? false
    : structural.length > 0 || logicOnly.length > 0 || (prev?.unreviewedChange ?? false);

  writeFileSync(path.join(out, 'rules-pack.json'), JSON.stringify(pack, null, 2) + '\n');
  writeFileSync(path.join(out, 'changes.json'), JSON.stringify([...changes, ...prevChanges].slice(0, MAX_CHANGES), null, 2) + '\n');
  if (process.argv.includes('--bundle')) {
    writeFileSync('src/core/rules/bundled-pack.json', JSON.stringify({ ...pack, unreviewedChange: false }, null, 2) + '\n');
  }

  if (structural.length > 0 || logicOnly.length > 0) {
    writeFileSync(
      path.join(out, 'issue.md'),
      [
        `Upstream ${REPO} changed in ways AlgoLens can't interpret automatically (${prev?.sourceSha.slice(0, 7)} → ${head.sha.slice(0, 7)}).`,
        '',
        ...(structural.length ? ['**Structural changes**', ...structural.map((c) => `- ${c.text}`), ''] : []),
        ...(logicOnly.length ? ['**Logic files touched**', ...logicOnly.map((f) => `- \`${f}\``), ''] : []),
        `Review the diff: https://github.com/${REPO}/compare/${prev?.sourceSha}...${head.sha}`,
        '',
        'Until this is reviewed, the extension shows "X changed something we haven\'t reviewed yet". After updating checks/signal map, publish a pack with unreviewedChange=false.',
      ].join('\n'),
    );
    writeOutput('structural', 'true');
  }
  writeOutput('changed', 'true');
  console.log(`Pack ${head.sha.slice(0, 7)}: ${changes.length} change(s), ${structural.length} structural, ${logicOnly.length} logic file(s).`);
}

function writeOutput(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
