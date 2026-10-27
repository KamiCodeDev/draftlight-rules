import * as v from 'valibot';

// The rules pack is DATA ONLY (MV3 forbids remote code). It is generated from
// xai-org/x-algorithm by tools/algo-sync, published to GitHub Pages, and
// validated here before the extension trusts a single value from it.

const finite = v.pipe(v.number(), v.finite());
const nonNegInt = v.pipe(v.number(), v.integer(), v.minValue(0));
const sha = v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/));
const isoDate = v.pipe(v.string(), v.isoTimestamp());

export const RulesPackSchema = v.strictObject({
  schemaVersion: v.literal(1),
  /** x-algorithm commit the values were extracted from. */
  sourceSha: sha,
  /** Commit time of sourceSha. */
  sourceDate: isoDate,
  /** "last sync" header of home-mixer/params/param.rs, if present. */
  paramSync: v.optional(isoDate),
  generatedAt: isoDate,
  /** Set when the upstream diff contained changes the generator does not understand. */
  unreviewedChange: v.boolean(),
  /** Action weights from home-mixer/params/param.rs (published defaults). */
  weights: v.record(v.pipe(v.string(), v.regex(/^[a-z_]+$/)), finite),
  thresholds: v.strictObject({
    maxPostAgeSecs: nonNegInt,
    mentionSpamCheckMin: nonNegInt,
    coldStart: v.strictObject({
      followerCap: nonNegInt,
      impressionThreshold: nonNegInt,
      maxPostAgeSecs: nonNegInt,
      slotMin: nonNegInt,
    }),
    oonWeightFactor: finite,
    authorDiversity: v.strictObject({ decay: finite, floor: finite }),
    accountNsfwAggregation: v.strictObject({
      windowSize: nonNegInt,
      minimumMatchingPosts: nonNegInt,
      maxPostAgeDays: nonNegInt,
      ttlDays: nonNegInt,
    }),
  }),
  /** Filter struct names active in the For You post pipeline. */
  filters: v.array(v.string()),
});

export type RulesPack = v.InferOutput<typeof RulesPackSchema>;

export type ParseResult = { ok: true; pack: RulesPack } | { ok: false; error: string };

export function parseRulesPack(input: unknown): ParseResult {
  const result = v.safeParse(RulesPackSchema, input);
  if (result.success) return { ok: true, pack: result.output };
  const issue = result.issues[0];
  const path = issue?.path?.map((p) => String(p.key)).join('.') ?? '';
  return { ok: false, error: `${path ? path + ': ' : ''}${issue?.message ?? 'invalid rules pack'}` };
}
