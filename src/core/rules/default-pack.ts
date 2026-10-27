import bundled from './bundled-pack.json';
import { parseRulesPack, type RulesPack } from './schema';

// Bundled fallback pack, used until (or whenever) the published pack can't be
// fetched or fails validation. Generated from xai-org/x-algorithm by
// `npm run algo-sync` (tools/algo-sync), never edited by hand.
const parsed = parseRulesPack(bundled);
if (!parsed.ok) throw new Error(`bundled rules pack is invalid: ${parsed.error}`);

export const DEFAULT_PACK: RulesPack = parsed.pack;

export const SHORT_SHA = DEFAULT_PACK.sourceSha.slice(0, 7);
