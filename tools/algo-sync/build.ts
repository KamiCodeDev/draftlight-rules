import { parseRulesPack, type RulesPack } from '../../src/core/rules/schema.ts';
import {
  extractWeights,
  parseFilters,
  parseMaxPostAge,
  parseMentionMin,
  parseNsfwAggregation,
  parseParams,
  paramSync,
} from './extract.ts';

// Pure: upstream source texts -> rules pack, and old pack vs new pack -> changes.

export interface Sources {
  sha: string;
  commitDate: string;
  homeMixerParams: string;
  vmRankerParams: string;
  pipeline: string;
  config: string;
  ptosFilter: string;
  labelRules: string;
}

export type BuildResult = { ok: true; pack: RulesPack } | { ok: false; errors: string[] };

export function buildPack(src: Sources, generatedAt: Date): BuildResult {
  const errors: string[] = [];
  const hm = parseParams(src.homeMixerParams);
  const vm = parseParams(src.vmRankerParams);
  const num = (m: Map<string, unknown>, key: string): number => {
    const v = m.get(key);
    if (typeof v !== 'number') {
      errors.push(`missing numeric param ${key}`);
      return 0;
    }
    return v;
  };
  const weights = extractWeights(hm);
  if (Object.keys(weights).length < 15) errors.push(`only ${Object.keys(weights).length} weights found in param.rs`);
  const maxPostAge = parseMaxPostAge(src.config);
  if (maxPostAge === undefined) errors.push('MAX_POST_AGE not found');
  const mentionMin = parseMentionMin(src.ptosFilter);
  if (mentionMin === undefined) errors.push('MIN_MENTION_COUNT not found');
  const agg = parseNsfwAggregation(src.labelRules);
  if (!agg) errors.push('nsfw_high_precision aggregation rule not found');
  const filters = parseFilters(src.pipeline);
  if (filters.length < 5) errors.push(`only ${filters.length} filters found`);

  const candidate = {
    schemaVersion: 1,
    sourceSha: src.sha,
    sourceDate: src.commitDate,
    ...(paramSync(src.homeMixerParams) ? { paramSync: paramSync(src.homeMixerParams) } : {}),
    generatedAt: generatedAt.toISOString(),
    unreviewedChange: false,
    weights,
    thresholds: {
      maxPostAgeSecs: maxPostAge ?? 0,
      mentionSpamCheckMin: mentionMin ?? 0,
      coldStart: {
        followerCap: num(hm, 'rust_home_mixer_cold_start_follower_cap'),
        impressionThreshold: num(hm, 'rust_home_mixer_cold_start_impression_threshold'),
        maxPostAgeSecs: num(hm, 'rust_home_mixer_cold_start_max_post_age_secs'),
        slotMin: num(hm, 'rust_home_mixer_cold_start_slot_min'),
      },
      oonWeightFactor: num(vm, 'rust_home_mixer_oon_weight_factor'),
      authorDiversity: {
        decay: num(vm, 'rust_home_mixer_author_diversity_decay'),
        floor: num(vm, 'rust_home_mixer_author_diversity_floor'),
      },
      accountNsfwAggregation: agg ?? { windowSize: 0, minimumMatchingPosts: 0, maxPostAgeDays: 0, ttlDays: 0 },
    },
    filters,
  };
  if (errors.length > 0) return { ok: false, errors };
  const parsed = parseRulesPack(candidate);
  return parsed.ok ? { ok: true, pack: parsed.pack } : { ok: false, errors: [parsed.error] };
}

export interface ChangeEntry {
  date: string;
  sha: string;
  kind: 'value' | 'structural';
  text: string;
}

const WEIGHT_MEANING: Record<string, string> = {
  favorite: 'likes',
  reply: 'replies',
  bidirectional_follow_reply_boost: 'replies from mutual follows on original posts',
  retweet: 'reposts',
  quote: 'quotes',
  share: 'shares',
  share_via_dm: 'shares via DM',
  share_via_copy_link: 'link copies',
  follow_author: 'follows from a post',
  click: 'post opens',
  open_link: 'link clicks',
  dwell: 'readers stopping on the post',
  not_interested: '"not interested" clicks',
  block_author: 'blocks',
  mute_author: 'mutes',
  report: 'reports',
};

function describeWeight(name: string, from: number, to: number): string {
  const what = WEIGHT_MEANING[name] ?? name.replace(/_/g, ' ');
  if (from === 0 && to !== 0) return `X started weighting ${what} (${to}).`;
  if (to === 0) return `X stopped weighting ${what} (was ${from}).`;
  const stronger = Math.abs(to) > Math.abs(from);
  const effect = to < 0 ? (stronger ? 'now hurt more' : 'now hurt less') : stronger ? 'now count more' : 'now count less';
  return `Predicted ${what} ${effect}: weight ${from} → ${to}.`;
}

/** Plain-English changes between two packs; structural = something the extension can't interpret by itself. */
export function diffPacks(prev: RulesPack | null, next: RulesPack): ChangeEntry[] {
  if (!prev) return [];
  const date = next.sourceDate.slice(0, 10);
  const sha = next.sourceSha;
  const out: ChangeEntry[] = [];
  const keys = new Set([...Object.keys(prev.weights), ...Object.keys(next.weights)]);
  for (const k of keys) {
    const a = prev.weights[k];
    const b = next.weights[k];
    if (a === undefined || b === undefined) {
      out.push({ date, sha, kind: 'structural', text: `Weight "${k}" was ${a === undefined ? 'added' : 'removed'}.` });
    } else if (a !== b) {
      out.push({ date, sha, kind: 'value', text: describeWeight(k, a, b) });
    }
  }
  const t0 = prev.thresholds;
  const t1 = next.thresholds;
  const val = (label: string, a: number, b: number) => {
    if (a !== b) out.push({ date, sha, kind: 'value', text: `${label}: ${a} → ${b}.` });
  };
  val('Posts older than this many hours leave For You', t0.maxPostAgeSecs / 3600, t1.maxPostAgeSecs / 3600);
  val('@mentions that trigger an extra spam check', t0.mentionSpamCheckMin, t1.mentionSpamCheckMin);
  val('Follower cap for the new-author boost', t0.coldStart.followerCap, t1.coldStart.followerCap);
  val('Hours a post can get the new-author boost', t0.coldStart.maxPostAgeSecs / 3600, t1.coldStart.maxPostAgeSecs / 3600);
  val('Home views before the new-author boost stops', t0.coldStart.impressionThreshold, t1.coldStart.impressionThreshold);
  val('Out-of-network discount factor', t0.oonWeightFactor, t1.oonWeightFactor);
  val('Same-author decay per extra post', t0.authorDiversity.decay, t1.authorDiversity.decay);
  val('Same-author decay floor', t0.authorDiversity.floor, t1.authorDiversity.floor);
  const a0 = t0.accountNsfwAggregation;
  const a1 = t1.accountNsfwAggregation;
  if (JSON.stringify(a0) !== JSON.stringify(a1)) {
    out.push({
      date, sha, kind: 'value',
      text: `Account NSFW label rule: ${a0.minimumMatchingPosts} of ${a0.windowSize} posts → ${a1.minimumMatchingPosts} of ${a1.windowSize} posts (label lasts ${a1.ttlDays} days).`,
    });
  }
  for (const f of next.filters.filter((x) => !prev.filters.includes(x))) {
    out.push({ date, sha, kind: 'structural', text: `New feed filter: ${f}.` });
  }
  for (const f of prev.filters.filter((x) => !next.filters.includes(x))) {
    out.push({ date, sha, kind: 'structural', text: `Feed filter removed: ${f}.` });
  }
  return out;
}
