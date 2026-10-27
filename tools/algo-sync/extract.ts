// Pure extraction of rules-pack values from xai-org/x-algorithm source files.
// No I/O here: run.ts fetches the files, this turns text into data.

export type ParamValue = number | boolean | string;

/** Every `param!(Name, type, "key", value);` in a params file, keyed by the feature-switch key. */
export function parseParams(src: string): Map<string, ParamValue> {
  const out = new Map<string, ParamValue>();
  const re = /param!\(\s*\w+\s*,\s*([^,]+?)\s*,\s*"([a-z0-9_]+)"\s*,\s*([\s\S]*?)\s*\);/g;
  for (const m of src.matchAll(re)) {
    const type = m[1]!.trim();
    const key = m[2]!;
    const raw = m[3]!.trim();
    if (/^(f64|f32|u\d+|i\d+|usize)$/.test(type)) {
      const n = Number(raw.replace(/_/g, ''));
      if (Number.isFinite(n)) out.set(key, n);
    } else if (type === 'bool') {
      if (raw === 'true' || raw === 'false') out.set(key, raw === 'true');
    } else if (type === 'String') {
      const s = raw.match(/^"(.*)"$/);
      if (s) out.set(key, s[1]!);
    }
  }
  return out;
}

/** "last sync" timestamp from param.rs header, if present. */
export function paramSync(src: string): string | undefined {
  const m = src.match(/last sync (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
  return m?.[1];
}

/** Filter struct names in pipeline order: pre-scoring filters, then post-selection filters. */
export function parseFilters(pipelineSrc: string): string[] {
  const out: string[] = [];
  for (const block of ['let filters:', 'let post_selection_filters:']) {
    const start = pipelineSrc.indexOf(block);
    if (start < 0) continue;
    const end = pipelineSrc.indexOf('];', start);
    const body = pipelineSrc.slice(start, end < 0 ? undefined : end);
    for (const m of body.matchAll(/Box::new\((\w+)/g)) out.push(m[1]!);
  }
  return out;
}

/** `pub const MAX_POST_AGE: u64 = 48 * 60 * 60;` -> 172800 */
export function parseMaxPostAge(configSrc: string): number | undefined {
  const m = configSrc.match(/MAX_POST_AGE:\s*u64\s*=\s*([\d\s*_]+);/);
  if (!m) return undefined;
  return m[1]!
    .split('*')
    .map((x) => Number(x.trim().replace(/_/g, '')))
    .reduce((a, b) => a * b, 1);
}

export function parseMentionMin(ptosFilterSrc: string): number | undefined {
  const m = ptosFilterSrc.match(/MIN_MENTION_COUNT\s*=\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export interface NsfwAggregation {
  windowSize: number;
  minimumMatchingPosts: number;
  maxPostAgeDays: number;
  ttlDays: number;
}

/** The default `nsfw_high_precision` rule from postToUserLabelRules.strato. */
export function parseNsfwAggregation(strato: string): NsfwAggregation | undefined {
  const start = strato.indexOf('"id": "nsfw_high_precision"');
  if (start < 0) return undefined;
  const body = strato.slice(start, start + 2000);
  const num = (k: string) => {
    const m = body.match(new RegExp(`"${k}":\\s*(\\d+)`));
    return m ? Number(m[1]) : undefined;
  };
  const r = {
    windowSize: num('windowSize'),
    minimumMatchingPosts: num('minimumMatchingPosts'),
    maxPostAgeDays: num('maxPostAgeDays'),
    ttlDays: num('userLabelTtlDays'),
  };
  return Object.values(r).every((v) => typeof v === 'number') ? (r as NsfwAggregation) : undefined;
}

/** Feature-switch key -> rules-pack weight name. */
export const WEIGHT_KEYS: Record<string, string> = {
  rust_home_mixer_favorite_weight: 'favorite',
  rust_home_mixer_reply_weight: 'reply',
  rust_home_mixer_bidirectional_follow_reply_weight_boost: 'bidirectional_follow_reply_boost',
  rust_home_mixer_retweet_weight: 'retweet',
  rust_home_mixer_photo_expand_weight: 'photo_expand',
  rust_home_mixer_video_open_weight: 'video_open',
  rust_home_mixer_click_weight: 'click',
  rust_home_mixer_open_link_weight: 'open_link',
  rust_home_mixer_profile_click_weight: 'profile_click',
  rust_home_mixer_vqv_weight: 'vqv',
  rust_home_mixer_share_weight: 'share',
  rust_home_mixer_share_via_dm_weight: 'share_via_dm',
  rust_home_mixer_share_via_copy_link_weight: 'share_via_copy_link',
  rust_home_mixer_dwell_weight: 'dwell',
  rust_home_mixer_quote_weight: 'quote',
  rust_home_mixer_quoted_click_weight: 'quoted_click',
  rust_home_mixer_follow_author_weight: 'follow_author',
  rust_home_mixer_cont_dwell_time_weight: 'cont_dwell_time',
  rust_home_mixer_cont_click_dwell_time_weight: 'cont_click_dwell_time',
  rust_home_mixer_not_interested_weight: 'not_interested',
  rust_home_mixer_block_author_weight: 'block_author',
  rust_home_mixer_mute_author_weight: 'mute_author',
  rust_home_mixer_report_weight: 'report',
  rust_home_mixer_not_dwelled_weight: 'not_dwelled',
};

export function extractWeights(params: Map<string, ParamValue>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, name] of Object.entries(WEIGHT_KEYS)) {
    const v = params.get(key);
    if (typeof v === 'number') out[name] = v;
  }
  return out;
}
