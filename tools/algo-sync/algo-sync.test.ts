import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK } from '../../src/core/rules/default-pack';
import { buildPack, diffPacks, type Sources } from './build';
import { extractWeights, parseFilters, parseMaxPostAge, parseMentionMin, parseNsfwAggregation, parseParams, paramSync } from './extract';

const fx = (name: string) => readFileSync(`tests/fixtures/algo/${name}`, 'utf8');

const sources = (paramFile: string): Sources => ({
  sha: '6258a1549ef808be88fba83d3b2d58364b587ee0',
  commitDate: '2026-10-24T03:22:45Z',
  homeMixerParams: fx(paramFile),
  vmRankerParams: fx('vm-params-2026-10-24.rs'),
  pipeline: fx('pipeline-2026-10-24.rs'),
  config: fx('config-2026-10-24.rs'),
  ptosFilter: fx('ptos-task-filter-2026-10-24.py'),
  labelRules: fx('post-to-user-label-rules-2026-10-24.strato'),
});

// Expected values were read by hand from the upstream history (see docs/signal-map.md).
describe('weights extracted from real param.rs history', () => {
  it.each([
    ['param-2026-08-13.rs', { favorite: 0.5, click: 0.4, dwell: 0, not_interested: -43.2, report: -234, reply: 5, bidirectional_follow_reply_boost: 15 }],
    ['param-2026-09-01.rs', { favorite: 0.5, click: 0.4, dwell: 0.05, not_interested: -43.2 }],
    ['param-2026-10-01.rs', { favorite: 0.5, click: 0.3, dwell: 0.05, not_interested: -47.52 }],
    ['param-2026-10-24.rs', { favorite: 0.66, click: 0.3, dwell: 0.05, not_interested: -52.272, share_via_copy_link: 20, mute_author: -58.8 }],
  ])('%s', (file, expected) => {
    expect(extractWeights(parseParams(fx(file)))).toMatchObject(expected);
  });
});

describe('other extractors', () => {
  it('param.rs details', () => {
    const p = parseParams(fx('param-2026-10-24.rs'));
    expect(p.get('rust_home_mixer_cold_start_follower_cap')).toBe(50000);
    expect(p.get('rust_home_mixer_min_video_duration_ms')).toBe(10000);
    expect(p.get('rust_home_mixer_enable_ranking')).toBe(true);
    expect(p.get('rust_home_mixer_ads_blender')).toBe('multi_risk');
    expect(paramSync(fx('param-2026-10-24.rs'))).toBe('2026-10-23T16:00:34Z');
  });
  it('filters, max age, mentions, aggregation', () => {
    const filters = parseFilters(fx('pipeline-2026-10-24.rs'));
    expect(filters.slice(0, 3)).toEqual(['DropDuplicatesFilter', 'ZeroFavCodivertFilter', 'CoreDataHydrationFilter']);
    expect(filters).toContain('FairShareRankingFilter');
    expect(filters.at(-1)).toBe('VideoCarouselFilter');
    expect(parseMaxPostAge(fx('config-2026-10-24.rs'))).toBe(172800);
    expect(parseMentionMin(fx('ptos-task-filter-2026-10-24.py'))).toBe(2);
    expect(parseNsfwAggregation(fx('post-to-user-label-rules-2026-10-24.strato'))).toEqual({ windowSize: 5, minimumMatchingPosts: 3, maxPostAgeDays: 60, ttlDays: 7 });
  });
  it('robust to garbage', () => {
    expect(parseParams('nothing').size).toBe(0);
    expect(parseFilters('')).toEqual([]);
    expect(parseMaxPostAge('')).toBeUndefined();
    expect(parseMentionMin('')).toBeUndefined();
    expect(parseNsfwAggregation('')).toBeUndefined();
  });
});

describe('buildPack', () => {
  it('builds a valid pack that matches the hand-made bundled values', () => {
    const r = buildPack(sources('param-2026-10-24.rs'), new Date('2026-10-26T00:00:00Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.weights).toEqual(DEFAULT_PACK.weights);
    expect(r.pack.thresholds).toEqual(DEFAULT_PACK.thresholds);
    expect(r.pack.paramSync).toBe('2026-10-23T16:00:34Z');
  });
  it('fails loudly when upstream files change shape', () => {
    const r = buildPack({ ...sources('param-2026-10-24.rs'), pipeline: '', config: 'x' }, new Date());
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['MAX_POST_AGE not found', 'only 0 filters found']));
  });
});

describe('diffPacks', () => {
  const build = (file: string) => {
    const r = buildPack(sources(file), new Date('2026-10-26T00:00:00Z'));
    if (!r.ok) throw new Error(r.errors.join(', '));
    return r.pack;
  };
  it('August -> October: plain-English value changes', () => {
    const changes = diffPacks(build('param-2026-08-13.rs'), build('param-2026-10-24.rs'));
    const texts = changes.map((c) => c.text);
    expect(texts).toContain('Predicted likes now count more: weight 0.5 → 0.66.');
    expect(texts).toContain('Predicted "not interested" clicks now hurt more: weight -43.2 → -52.272.');
    expect(texts).toContain('Predicted post opens now count less: weight 0.4 → 0.3.');
    expect(texts).toContain('X started weighting readers stopping on the post (0.05).');
    expect(changes.every((c) => c.kind === 'value')).toBe(true);
  });
  it('structural changes are flagged', () => {
    const next = build('param-2026-10-24.rs');
    const prev = { ...next, filters: next.filters.filter((f) => f !== 'FairShareRankingFilter'), weights: { ...next.weights, legacy_thing: 1 } };
    const changes = diffPacks(prev, next);
    expect(changes.filter((c) => c.kind === 'structural').map((c) => c.text)).toEqual([
      'Weight "legacy_thing" was removed.',
      'New feed filter: FairShareRankingFilter.',
    ]);
  });
  it('no previous pack, or identical packs -> no changes', () => {
    const p = build('param-2026-10-24.rs');
    expect(diffPacks(null, p)).toEqual([]);
    expect(diffPacks(p, p)).toEqual([]);
  });
});
