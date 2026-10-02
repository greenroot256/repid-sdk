// Which requirement each test actually proves.
//
// `constitution.md` Article 3 requires that every requirement have a real
// automated test. Until this file existed, that was an assertion nobody could
// check: the specifications declare 157 requirements, the suites cited 9
// identifiers between them, and the two numbers were never compared. Writing the
// mapping by hand would not have fixed that, because a hand-kept table drifts and
// nothing would notice. So this file is read by `traceability.test.ts`, which
// resolves every citation to a test that actually exists in the corpus and fails
// the build if one does not. The table cannot rot without the suite going red.
//
// Three rules govern what may appear here:
//
//   1. A citation names a test that exists. Not a test that should exist, and not
//      a description of one. If the assertion lives in a helper, cite the test
//      that calls it.
//   2. A requirement with no test is declared, with a reason. Silence is not
//      acceptable: an undeclared gap cannot be counted, so it cannot be closed.
//   3. A prohibition is not a test case. RF-O20 forbids on-chain value judgment.
//      No assertion can prove the absence of a class of code, so it is verified by
//      inspection and recorded as such rather than given a token test that would
//      prove nothing.

/** A requirement, the tests that prove it, and what that evidence establishes. */
export interface Covered {
  /** `file.test.ts :: exact test name`, resolved by the traceability test. */
  readonly tests: readonly string[];
  /** What the citation proves, and any limit on it. */
  readonly note: string;
}

const VAULT = 'identity_vault_indexer.test.ts';
const SHAPE = 'receipt_genesis_shape.test.ts';
const RATING = 'issued_rating_and_indexer.test.ts';
const CONSUME = 'rating_right_consumption.test.ts';
const PLATFORM = 'platform_confirmation.test.ts';
const TRUST = 'trust_link.test.ts';
  const OPCODE = 'op_return_encoding.test.ts';
  const BINDING = 'covenant_binding.test.ts';
  const REAL = 'real_chain_binding.test.ts';

export const COVERED: Readonly<Record<string, Covered>> = {
  // --- SPEC-008 section 4.1, token structure --------------------------------
  'SPEC-008/RF-O01': {
    tests: [
      `${SHAPE} :: rejects a Receipt NFT with capability mutable`,
      `${SHAPE} :: rejects a Receipt NFT with capability minting`,
      `${SHAPE} :: rejects a mutable Rating Right even when the Receipt itself is fine`,
      `${SHAPE} :: rejects a minting Rating Right`,
      `${SHAPE} :: rejects an NFT that carries a fungible amount`,
    ],
    note:
      'capability and tokenAmount are enforced by the recognizer, and CashTokens ' +
      'independently refuses a mutable or minting NFT in a genesis. The tests ' +
      'perturb a decoded transaction, so they show the recognizer rejects the ' +
      'shape on its own; the covenant never gets the chance to agree.',
  },

  // --- SPEC-008 section 4.2, identity and collateral -----------------------
  'SPEC-008/RF-O03': {
    tests: [
      `${VAULT} :: recognizes the vault genesis and tracks the covenant outpoint with collateral and ownerPkh`,
    ],
    note:
      'the recognizer reads the vault genesis and keeps the category, the owner ' +
      'pkh and the collateral value, which is the state RF-O03 makes observable. ' +
      'That the value is strictly greater than zero is enforced by the covenant, ' +
      'not asserted here.',
  },
  'SPEC-008/RF-O05': {
    tests: [
      `${VAULT} :: marks a top-up as valid, records IDENTITY_COLLATERAL_TOP_UP and moves the tracking to the new outpoint`,
    ],
    note:
      'a top-up is only recognised as valid when the re-locked output keeps the ' +
      'category and the commitment and does not reduce the value, so the ' +
      'monotonicity the requirement states is what makes the test pass.',
  },
  'SPEC-008/RF-O06': {
    tests: [
      `${VAULT} :: recognizes the burn as IDENTITY_BURNED and removes the identity tracking`,
      `${VAULT} :: after a burn no longer confuses the owner's next spend with any RepID shape`,
    ],
    note:
      'the second case is the load-bearing one: after the burn, the category must ' +
      'not reappear, and the test shows the next spend of the same owner is not ' +
      'read as an identity operation.',
  },
  'SPEC-008/RF-O07': {
    tests: [
      `${SHAPE} :: rejects a genesis whose change output carries a token`,
      `${RATING} :: recognizes an IDENTITY_GENESIS alongside the change output`,
      `${RATING} :: recognizes a RECEIPT_GENESIS alongside the change output`,
    ],
    note:
      'the change output is the case most easily given tokens by accident, and the ' +
      'other two confirm a tokenless change does not stop recognition.',
  },

  // --- SPEC-008 section 4.3, receipt ---------------------------------------
  'SPEC-008/RF-O09': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: recognizes the same three NFTs without the change output`,
      `${SHAPE} :: rejects a genesis with only two outputs, missing a Rating Right`,
      `${SHAPE} :: rejects a genesis with five outputs, one more than a change output`,
    ],
    note:
      'the recognizer accepts three or four outputs and rejects two or five, so the ' +
      'output count is bounded on both sides. Note the asymmetry with SPEC-009/RF-W38, ' +
      'which accepts the same three or four: the recognizer is deliberately more ' +
      'permissive than the covenant, because a three-output genesis cannot be ' +
      'produced by the covenant but can exist on chain.',
  },
  'SPEC-008/RF-O10': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: rejects a Rating Right that commits to its own holder`,
      `${SHAPE} :: rejects swapped commitments, which is the same shape read backwards`,
      `${SHAPE} :: rejects a Rating Right with an empty commitment`,
      `${SHAPE} :: rejects a Receipt that carries a non-empty commitment`,
    ],
    note:
      'the cross relationship is checked in both directions. "swapped commitments" ' +
      'is the same valid-looking shape read the other way round, which is the ' +
      'failure mode a one-sided check would miss.',
  },
  'SPEC-008/RF-O11': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: rejects a genesis whose change output carries a token`,
    ],
    note: 'the change output is checked for both its destination and its contents.',
  },

  // --- SPEC-008 section 4.4, rating ----------------------------------------
  'SPEC-008/RF-O12': {
    tests: [
      `${CONSUME} :: retires the Rating Right when it is spent`,
      `${CONSUME} :: does not attribute a second rating to the same Rating Right`,
      `${CONSUME} :: leaves the other party's Rating Right untouched`,
      `${RATING} :: spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)`,
    ],
    note:
      'single use is enforced by retiring the outpoint, and the NFT is not ' +
      're-issued, so a second rating cannot be attributed to the same right.',
  },
  'SPEC-008/RF-O13': {
    tests: [
      `${RATING} :: spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)`,
      `${RATING} :: recognizes a RATING_ISSUED by crossing it with the already indexed Rating Right`,
    ],
    note:
      'the tag and the 1-5 range are exercised end to end; the encoding of the ' +
      'container itself is covered by the RF-W01 and RF-W05 rows.',
  },
  'SPEC-008/RF-O14': {
    tests: [
      `${RATING} :: marks as invalid a RATING_ISSUED whose score is out of the 1-5 range (SPEC-004 RF-04)`,
      `${CONSUME} :: retires the Rating Right even when the score is out of range`,
    ],
    note:
      'the requirement has two halves and both are asserted: the fact is emitted ' +
      'with valid:false rather than dropped, and the Rating Right is still ' +
      'retired. Retiring on an invalid score is what stops a wallet from retrying ' +
      'the same right.',
  },

  // --- SPEC-008 section 4.5, platform validation and trust ------------------
  'SPEC-008/RF-O15': {
    tests: [
      `${PLATFORM} :: recognizes a platform attestation that references an already indexed Receipt`,
      `${PLATFORM} :: marks as invalid a confirmation that references an unknown Receipt`,
    ],
    note:
      'a confirmation is only valid against a Receipt already in the index, so the ' +
      'test that indexes one first is what makes the second meaningful.',
  },
  'SPEC-008/RF-O16': {
    tests: [
      `${TRUST} :: does not recognize an OP_RETURN with a foreign tag or a different payload size`,
    ],
    note:
      'the positive case is the unilateral-declaration test, which is cited under ' +
      'SPEC-008/RF-E07 because it establishes that no Rating Right and no counter-' +
      'signature are needed. The 20-byte payload length is what this row adds.',
  },
  'SPEC-008/RF-O17': {
    tests: [`${TRUST} :: marks a self-trust declaration as invalid (A trusts A)`],
    note: 'self-trust is recognised as a shape and then marked invalid, not dropped.',
  },

  // --- SPEC-008 section 4.6, mutability ------------------------------------
  'SPEC-008/RF-O18': {
    tests: [
      `${SHAPE} :: rejects a Receipt NFT with capability mutable`,
      `${SHAPE} :: rejects a Receipt NFT with capability minting`,
      `${VAULT} :: recognizes the burn as IDENTITY_BURNED and removes the identity tracking`,
      `${RATING} :: spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)`,
    ],
    note:
      'immutability is observable from two directions: a capability other than ' +
      'none is rejected, and a burn does not re-issue the category. Together they ' +
      'cover both halves of "not mutable nor re-mintable".',
  },
  'SPEC-008/RF-O19': {
    tests: [
      `${CONSUME} :: persists the retirement, so a restart cannot resurrect a spent right`,
      `${VAULT} :: persists the identity tracking in the JSON store and survives a reload`,
    ],
    note:
      'what these show is that retained state is append-only across a restart: a ' +
      'spent right and a burned identity do not come back. They do not show that a ' +
      'fact already indexed can be altered in place, because no code path offers ' +
      'one.',
  },

  // --- SPEC-008 section 5, verification and indexing -----------------------
  'SPEC-008/RF-E07': {
    tests: [
      `${TRUST} :: recognizes a unilateral A\u2192B declaration (only A signs, no Rating Rights)`,
    ],
    note:
      'the only signer is the truster, and no Rating Right is consumed. This is the ' +
      'requirement that makes a Trust Link usable at cold start.',
  },

  // --- SPEC-009, container parsing and recognition --------------------------
  'SPEC-009/RF-W01': {
    tests: [
      `${OPCODE} :: splits a direct tag push followed by a direct payload push`,
      `${OPCODE} :: preserves chunk boundaries instead of concatenating the payload`,
      `${OPCODE} :: preserves a multi-byte payload as a single chunk`,
      `${OPCODE} :: decodes the tag as UTF-8 text`,
    ],
    note: 'the accepted container shape, including that chunks stay separate.',
  },
  'SPEC-009/RF-W02': {
    tests: [
      `${OPCODE} :: rejects OP_0 (0x00) in the tag position`,
      `${OPCODE} :: rejects OP_0 in a payload position`,
      `${OPCODE} :: accepts a pushed zero byte, which is a one-byte chunk and not OP_0`,
      `${OPCODE} :: rejects a zero-length push anywhere`,
    ],
    note:
      'the third case is the discriminating one: a pushed 0x00 byte is a one-byte ' +
      'chunk and must be accepted, while the OP_0 opcode must not. A parser that ' +
      'simply rejects any zero byte would pass the first two and fail this one.',
  },
  'SPEC-009/RF-W05': {
    tests: [
      `${OPCODE} :: does not accept a tag that is a prefix of the real one`,
      `${OPCODE} :: does not accept a tag with the real one as a prefix`,
      `${OPCODE} :: is case sensitive, so a lowercased tag is a different tag`,
      `${OPCODE} :: keeps the other two RepID tags distinct from each other`,
    ],
    note:
      'exact byte equality, in both directions and in case. This is also the row ' +
      'that makes the SPEC-010 section 6 tag-revision rule work: a tag with an ' +
      'unrecognised revision matches nothing.',
  },
  'SPEC-009/RF-W08': {
    tests: [
      `${RATING} :: marks as invalid a RATING_ISSUED whose score is out of the 1-5 range (SPEC-004 RF-04)`,
    ],
    note:
      'a score outside the range yields a fact with valid:false, not a dropped ' +
      'transaction. The same behaviour is cited under RF-O14, which states it as ' +
      'a protocol invariant.',
  },
  'SPEC-009/RF-W21': {
    tests: [
      `${CONSUME} :: retires the Rating Right when it is spent`,
      `${CONSUME} :: does not attribute a second rating to the same Rating Right`,
      `${CONSUME} :: retires the Rating Right even when the score is out of range`,
      `${CONSUME} :: leaves the other party's Rating Right untouched`,
      `${CONSUME} :: persists the retirement, so a restart cannot resurrect a spent right`,
    ],
    note:
      'the requirement is that resolution removes the outpoint from the tracked ' +
      'set. The five cases are the five ways that removal used to fail.',
  },
  'SPEC-009/RF-W38': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: recognizes the same three NFTs without the change output`,
      `${SHAPE} :: rejects a genesis with only two outputs, missing a Rating Right`,
      `${SHAPE} :: rejects a genesis with five outputs, one more than a change output`,
    ],
    note: 'three or four outputs, and the fourth must be a tokenless change.',
  },
  'SPEC-009/RF-W39': {
    tests: [
      `${SHAPE} :: rejects a Receipt NFT with capability mutable`,
      `${SHAPE} :: rejects a Receipt NFT with capability minting`,
      `${SHAPE} :: rejects a mutable Rating Right even when the Receipt itself is fine`,
      `${SHAPE} :: rejects a minting Rating Right`,
      `${SHAPE} :: rejects an NFT that carries a fungible amount`,
      `${SHAPE} :: rejects NFTs that do not share one category`,
    ],
    note: 'capability, fungible amount and the single shared category.',
  },
  'SPEC-009/RF-W40': {
    tests: [
      `${SHAPE} :: rejects a Rating Right that commits to its own holder`,
      `${SHAPE} :: rejects swapped commitments, which is the same shape read backwards`,
      `${SHAPE} :: rejects a Rating Right with an empty commitment`,
      `${SHAPE} :: rejects a Receipt that carries a non-empty commitment`,
    ],
    note: 'the cross relationship and the empty commitment on the Receipt itself.',
  },
  'SPEC-009/RF-W45': {
    tests: [
      `${OPCODE} :: rejects a final push that claims more bytes than remain`,
      `${OPCODE} :: rejects a tag push that claims more bytes than remain`,
      `${OPCODE} :: rejects a middle push that runs past the end, ignoring the trailing bytes`,
      `${OPCODE} :: accepts a length that exactly consumes the remaining bytes`,
    ],
    note:
      'a push that declares more bytes than the script contains is refused, and ' +
      'the exact boundary is accepted, so the rule is not implemented as a ' +
      'stricter-than-required comparison.',
  },
  // --- SPEC-009 section 12, binding verification (optional) ------------------
  'SPEC-009/RF-W47': {
    tests: [
      `${BINDING} :: reveals the canonical redeem script on the vault input`,
      `${BINDING} :: reveals the canonical redeem script on the receipt input`,
      `${BINDING} :: pushes the constructor arguments in reverse declaration order`,
      `${BINDING} :: differs per owner, which is why the expected script is rebuilt`,
      `${BINDING} :: rejects a scriptSig whose last push is the covenant body without its args`,
      `${REAL} :: recognizes both identity genesis transactions and binds each to the vault`,
      `${REAL} :: recognizes the receipt genesis and binds it to the receipt covenant`,
    ],
    note:
      'the expected script is rebuilt from the canonical bytecode plus the pkh ' +
      'values the recognizer already read, never compared against a constant. The ' +
      'real-chain half matters because it is compiled and broadcast by a toolchain ' +
      'that did not write the check.',
  },
  'SPEC-009/RF-W48': {
    tests: [
      `${BINDING} :: accepts the classic 23-byte P2SH form as well as the CashTokens one`,
      `${BINDING} :: reads the long push form, which is what these scripts need`,
    ],
    note:
      'both P2SH hash forms are accepted and the function is selected from the ' +
      'width found, so the same 20 bytes under the 32-byte form does not match.',
  },
  'SPEC-009/RF-W49': {
    tests: [
      `${BINDING} :: reports a vault locked to a foreign P2SH as a valid identity today`,
      `${BINDING} :: reports a receipt whose covenant was never run as a valid receipt today`,
      `${BINDING} :: rejects a P2PKH output as a vault, which a hash check alone would miss`,
      `${BINDING} :: does not accept a receipt whose covenant was instantiated for other parties`,
      `${BINDING} :: rejects a scriptSig whose last push is the covenant body without its args`,
      `${BINDING} :: reports a scriptSig with no final push instead of guessing at its tail`,
    ],
    note:
      'the first two are the impostors the base recognizer accepts today, which ' +
      'is what makes them worth asserting: the vector is the live gap, not a ' +
      'hypothetical one.',
  },
  'SPEC-009/RF-W50': {
    tests: [
      `${REAL} :: recognizes both ratings, which have no covenant to bind to`,
    ],
    note:
      'a control case. Requiring binding of a fact that has no covenant behind it ' +
      'would be a false rejection, so the ratings are asserted to survive.',
  },
  'SPEC-009/RF-W53': {
    tests: [
      `${BINDING} :: emits no binding verdict for a legacy genesis, instead of a failed one`,
    ],
    note:
      'the legacy form is out of scope for binding and stays recognized. The test ' +
      'also pins why the order matters: a P2PKH spend ends in a 65-byte signature, ' +
      'so reading the unlocking script first would make a legacy genesis ' +
      'indistinguishable from a vault instantiated for the wrong owner.',
  },
};

/**
 * Requirements with no automated test, and why. A reason is required: an
 * undeclared gap cannot be counted, and a gap that cannot be counted never gets
 * closed.
 */
/** A requirement with no automated test: why not, and what would close it. */
export interface Uncovered {
  readonly why: string;
  readonly fix: string;
}

export const UNCOVERED: Readonly<Record<string, Uncovered>> = {
  'SPEC-008/RF-O02': {
    why: 'Covenant property plus a CashTokens consensus rule: the genesis category is the spent outpoint txid and that outpoint must be vout 0. No recognizer behaviour can be tested against it, because the recognizer reads the category rather than deriving it. Evidence is the real-VM E2E in the demo, not a unit test.',
    fix: 'a test that builds a genesis from vout 1 and observes the rejection',
  },
  'SPEC-008/RF-O04': {
    why: 'The covenant requires the owner signature on all three spend paths. It is exercised by every builder-driven mint, because the builder runs the contract in a debug VM, but no test asserts that a missing or wrong signature is refused. A negative test needs a signing setup the current tooling cannot express without a custom unlocker.',
    fix: 'blocked on tooling, not on effort',
  },
  'SPEC-008/RF-O08': {
    why: 'The joint signature of both parties is required by the covenant and enforced when the E2E mints a Receipt, but no test asserts that a one-sided signature is refused. Same tooling limitation as RF-O04.',
    fix: 'blocked on tooling, not on effort',
  },
  'SPEC-008/RF-O20': {
    why: 'A prohibition, not a behaviour: no on-chain rule may encode a value judgment. An assertion cannot prove the absence of a class of code. Verified by enumerating all 60 require statements in the three covenants, recorded in CONSTITUTION-AUDIT.md Article 1.',
    fix: 'verified by inspection; not convertible into a test',
  },
  // --- Binding verification, declared before it was implemented --------------
  // These four are the honest state of section 12 as of this commit: the module
  // and its tests exist, and the wire to the recognizer does not. Recording them
  // as uncovered is the point — a requirement mapped to a test that never
  // exercises it would be worse than a gap.
  'SPEC-008/RF-V12': {
    why: 'The rule that only a bound genesis establishes an identity is specified and the binding check it rests on is implemented and tested, but the recognizer does not yet consume the verdict: indexRawTransaction still returns the shape regardless. Nothing can assert the rule end to end while the last link is missing.',
    fix: 'wire binding into indexRawTransaction as an opt-in flag, then assert that an unbound vault genesis yields no identity',
  },
  'SPEC-008/RF-V13': {
    why: 'The recognition half is covered (schema_conformance validates a legacy identity genesis) and the binding half by SPEC-009/RF-W53. What no test can assert yet is the absence of an identity, because the SDK has no notion of one to assert about.',
    fix: 'comes with RF-V12: an identity-availability query over the store, tested against a legacy and a bound genesis side by side',
  },
  'SPEC-009/RF-W52': {
    why: 'Same gap as SPEC-008/RF-V12 seen from the recognition side, and the same fix. The module proves the bytes match; nothing yet consumes that to withhold an identity.',
    fix: 'covered by the same change that covers RF-V12',
  },
  'SPEC-009/RF-W46': {
    why: 'A permission, not a behaviour. "MAY verify binding" cannot fail, so a test for it would assert that an option exists in the type system at most. Its substance is tested under RF-W47 and RF-W49.',
    fix: 'verified by the RF-W47 and RF-W49 citations; not convertible into a separate test',
  },
  'SPEC-009/RF-W51': {
    why: 'A prohibition on a claim rather than on a behaviour: binding must not be described as signature verification. No assertion can prove how prose describes itself.',
    fix: 'verified by inspection of the module header and SPEC-009 section 12.3, both of which state the limit; not convertible into a test',
  },
  'SPEC-009/RF-W54': {
    why: 'The capability declaration is a claim an implementation makes about itself, and the honest test is that the claim is false when a covenant-backed path is left unverified. No such declaration exists yet, so there is nothing to test.',
    fix: 'covered by the change that covers RF-V52; then assert that declaring the capability without applying section 12 everywhere is rejected',
  },
};

/**
 * Why the remaining requirements of a specification have no citation. Used for
 * every requirement of that specification that is not in `COVERED`, so a new
 * requirement is covered by an existing explanation rather than silently
 * appearing as undeclared.
 */
export const SPEC_DEFAULT_REASON: Readonly<Record<string, string>> = {
  'SPEC-001':
    'Legacy specification, retained as the record of RFC-001. Its requirements are restated normatively in SPEC-008 section 4, where they are mapped to tests; this specification adds no requirement that is not covered there.',
  'SPEC-002':
    'Legacy specification for the off-chain interaction layer, which lives in the demo repository and is exercised by that repository\'s own tests. SPEC-008 section 2 restates it normatively.',
  'SPEC-003':
    'Legacy specification. The Receipt invariants are restated in SPEC-008 sections 4.3 and 4.5, where the relevant requirements are mapped to tests.',
  'SPEC-004':
    'Legacy specification for rating. The invariants are restated in SPEC-008 section 4.4, where RF-O12, RF-O13 and RF-O14 are mapped to tests. The score-range requirement is additionally cited by the test that enforces it.',
  'SPEC-005':
    'Legacy specification for the indexer. Recognition requirements are restated in SPEC-009, where the container-parsing and Receipt-shape requirements are mapped to tests.',
  'SPEC-006':
    'Legacy specification for the Trust Link. Restated in SPEC-008 section 4.5; RF-O16, RF-O17 and RF-E07 are mapped to tests.',
  'SPEC-008':
    'Declared normative, but not yet mapped to a specific test. This is the largest remaining traceability gap and the one worth closing first: these are the on-chain invariants and the recognition rules the protocol exists to define.',
  'SPEC-009':
    'Recognition and wire-format requirement without a citation. Some are the vectors SPEC-009 Annex B.2 records as still open, which are not a mapping failure but a known gap in the suite.',
};

/**
 * Minimum share of each specification's requirements that must carry a citation.
 * This is a floor, not a target: it exists so that coverage cannot silently
 * regress, and it is expected to rise. Raising it is the standing work.
 */
export const COVERAGE_FLOOR: Readonly<Record<string, number>> = {
  'SPEC-008': 0.2,
  'SPEC-009': 0.18,
};
