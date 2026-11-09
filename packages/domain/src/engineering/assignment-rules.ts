import { DomainError } from '../errors';

/**
 * FB-06 (F-062, D-008 open, A-006): routing suggestions for the engineering assignment.
 *
 * Today one engineer is assigned per quote, by the lead. Paul Slomkowski's answer (Nov 4, "Engineering
 * Resources") is that the engineer follows the process and the resin: ISBM, RHB and injection go to the PET
 * engineer, EBM and IBM to the polyolefin engineer. `app_setting.engineering_assignment_rules` holds that
 * as data (provisional, rule 4), and the assign dialog shows "Suggested: <name>". It is a suggestion only:
 * the lead still assigns (`queue.assign`), and nothing here assigns anyone.
 *
 * A rule matches when every condition it lists holds: `processTypes` (the Engineering Review's process
 * type) and `resins` (the quote's resin), an empty list meaning "any". A rule with both lists empty
 * matches nothing, so a half-typed rule never suggests everyone. Rules are tried in order; the first
 * match wins. The process type is usually not chosen yet when the lead assigns, so the seed also carries
 * resin rules after the process rules.
 *
 * The engineer is named by `engineerName` (a surname or full name, matched against the directory name of
 * an assignable engineer, so a first-name spelling difference does not matter) and optionally pinned to a
 * user by `engineerUserId`. A name that matches no user, or more than one, suggests nobody.
 */
export interface AssignmentRule {
  processTypes: string[];
  resins: string[];
  engineerName: string;
  engineerUserId: string | null;
  /** Where the rule comes from, shown to Admins (never to engineers). */
  note: string | null;
}

export interface AssignmentRules {
  rules: AssignmentRule[];
}

/** The seed from Paul Slomkowski's Nov 4 email (provisional). Codes are the process_type / resin lists. */
export const ASSIGNMENT_RULES_SEED: AssignmentRules = {
  rules: [
    {
      processTypes: ['ISBM', 'RHB', 'IMM'],
      resins: [],
      engineerName: 'Neiberger',
      engineerUserId: null,
      note: 'Paul Slomkowski, Nov 4: ISBM, RHB and injection (IMM) go to the PET engineer.',
    },
    {
      processTypes: ['EBM', 'IBM'],
      resins: [],
      engineerName: 'Pasillas',
      engineerUserId: null,
      note: 'Paul Slomkowski, Nov 4: EBM and IBM go to the polyolefin engineer.',
    },
    {
      processTypes: [],
      resins: ['PET', 'PCR_PET', 'PETG'],
      engineerName: 'Neiberger',
      engineerUserId: null,
      note: 'Fallback while the process type is not chosen: PET resins go to the PET engineer.',
    },
    {
      processTypes: [],
      resins: ['HDPE', 'PCR_HDPE', 'PP', 'LDPE'],
      engineerName: 'Pasillas',
      engineerUserId: null,
      note: 'Fallback while the process type is not chosen: polyolefin resins go to the polyolefin engineer.',
    },
  ],
};

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 40);

/** Null / undefined → the seed. A malformed value is an INVALID_CONFIG error (the Admin console shows it). */
export function parseAssignmentRules(input: unknown): AssignmentRules {
  if (input === undefined || input === null) {
    return { rules: ASSIGNMENT_RULES_SEED.rules.map((r) => ({ ...r })) };
  }
  const bad = (msg: string) =>
    new DomainError('INVALID_CONFIG', `engineering_assignment_rules: ${msg}`);
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('must be an object');
  const raw = (input as { rules?: unknown }).rules;
  if (!Array.isArray(raw)) throw bad('"rules" must be a list');
  if (raw.length > 100) throw bad('at most 100 rules');
  const rules = raw.map((r, i): AssignmentRule => {
    if (typeof r !== 'object' || r === null || Array.isArray(r))
      throw bad(`rule ${i + 1} must be an object`);
    const o = r as Record<string, unknown>;
    const processTypes = o.processTypes ?? [];
    const resins = o.resins ?? [];
    if (!isStringList(processTypes))
      throw bad(`rule ${i + 1}: processTypes must be a list of codes`);
    if (!isStringList(resins)) throw bad(`rule ${i + 1}: resins must be a list of codes`);
    if (processTypes.length === 0 && resins.length === 0) {
      throw bad(`rule ${i + 1}: name at least one process type or resin`);
    }
    if (
      typeof o.engineerName !== 'string' ||
      !o.engineerName.trim() ||
      o.engineerName.length > 120
    ) {
      throw bad(`rule ${i + 1}: engineerName is required (a surname or full name)`);
    }
    const userId = o.engineerUserId ?? null;
    if (userId !== null && typeof userId !== 'string') {
      throw bad(`rule ${i + 1}: engineerUserId must be a user id or null`);
    }
    const note = o.note ?? null;
    if (note !== null && (typeof note !== 'string' || note.length > 400)) {
      throw bad(`rule ${i + 1}: note must be text of at most 400 characters`);
    }
    return {
      processTypes: processTypes.map((c) => c.trim()),
      resins: resins.map((c) => c.trim()),
      engineerName: o.engineerName.trim(),
      engineerUserId: userId,
      note,
    };
  });
  return { rules };
}

export interface SuggestionCandidate {
  id: string;
  displayName: string;
}

export interface EngineerSuggestion {
  userId: string;
  name: string;
  /** What the rule matched on, for the "Suggested: <name> (ISBM)" hint. */
  basis: { processType: string | null; resin: string | null };
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * The engineer the first matching rule names, if exactly one of `candidates` (active, assignable users)
 * fits it. Null when nothing matches, the name matches nobody, or the name is ambiguous.
 */
export function suggestEngineer(
  rules: AssignmentRules,
  input: { processType: string | null; resin: string | null },
  candidates: readonly SuggestionCandidate[],
): EngineerSuggestion | null {
  for (const rule of rules.rules) {
    if (rule.processTypes.length === 0 && rule.resins.length === 0) continue;
    if (
      rule.processTypes.length > 0 &&
      !(input.processType && rule.processTypes.includes(input.processType))
    ) {
      continue;
    }
    if (rule.resins.length > 0 && !(input.resin && rule.resins.includes(input.resin))) continue;

    const wanted = tokens(rule.engineerName);
    const matches = rule.engineerUserId
      ? candidates.filter((c) => c.id === rule.engineerUserId)
      : candidates.filter((c) => {
          const have = new Set(tokens(c.displayName));
          return wanted.length > 0 && wanted.every((t) => have.has(t));
        });
    // The rule applies to this quote, so a missing or ambiguous engineer ends the search: a later,
    // broader rule must not quietly suggest someone else for it.
    if (matches.length !== 1) return null;
    const [who] = matches;
    return {
      userId: who!.id,
      name: who!.displayName,
      basis: {
        processType: rule.processTypes.length > 0 ? input.processType : null,
        resin: rule.resins.length > 0 ? input.resin : null,
      },
    };
  }
  return null;
}
