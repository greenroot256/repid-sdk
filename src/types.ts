// The seven RepID fact types, and the state a recognizer must retain to derive
// them deterministically.
//
// Field sets here are closed on purpose. The JSON Schema in
// `src/protocol/schemas/repid-fact.schema.json` is the normative definition and
// rejects unknown fields; these types mirror it, and a test validates every
// emitted fact against the Schema so the two cannot drift apart silently.
//
// Amounts are strings, never numbers. A satoshi amount can exceed
// Number.MAX_SAFE_INTEGER, and a reputation value computed from a rounded
// collateral is a wrong reputation value that looks right.

/** A 20-byte public key hash, lowercase hex, no `0x`. */
export type Pkh = string;

/** A 32-byte transaction id, lowercase hex, no `0x`. Order is display order. */
export type Txid = string;

/** A 32-byte CashTokens category id, lowercase hex, no `0x`. */
export type Category = string;

/** Satoshis, as a decimal string so no precision is lost. */
export type AmountString = string;

/** A `txid:vout` outpoint, the key the retained state is indexed by. */
export type Outpoint = string;

/**
 * SPEC-001. Two recognized shapes, distinguished by the presence of
 * `collateral`: the legacy P2PKH genesis, and the vault genesis where the NFT
 * is locked to the covenant together with collateral.
 */
export interface IdentityGenesisFact {
  type: 'IDENTITY_GENESIS';
  txid: Txid;
  identityCategory: Category;
  ownerPkh: Pkh;
  /** Present only for the vault shape; the legacy shape has no collateral. */
  collateral?: AmountString;
  /** Present only for the vault shape: the covenant UTXO to track. */
  identityOutpoint?: Outpoint;
}

/** SPEC-001. `valid: false` marks a top-up that attempted to decrease. */
export interface IdentityCollateralTopUpFact {
  type: 'IDENTITY_COLLATERAL_TOP_UP';
  txid: Txid;
  identityCategory: Category;
  ownerPkh: Pkh;
  spentOutpoint: Outpoint;
  previousCollateral: AmountString;
  collateral: AmountString;
  valid: boolean;
}

/** SPEC-001. The category does not reappear, so the identity is gone. */
export interface IdentityBurnedFact {
  type: 'IDENTITY_BURNED';
  txid: Txid;
  identityCategory: Category;
  ownerPkh: Pkh;
  spentOutpoint: Outpoint;
  valid: boolean;
}

/** One of the two single-use Rating Rights a Receipt genesis mints. */
export interface RatingRightRecord {
  outpoint: Outpoint;
  ownerPkh: Pkh;
  ratesPkh: Pkh;
}

/** SPEC-003. Requires both parties' signatures, by construction of the shape. */
export interface ReceiptGenesisFact {
  type: 'RECEIPT_GENESIS';
  txid: Txid;
  receiptCategory: Category;
  receiptOwnerPkh: Pkh;
  ratingRights: [RatingRightRecord, RatingRightRecord];
}

/**
 * SPEC-004. The Rating Right is burned by being spent, which is what enforces
 * one rating per participant at the UTXO level. `score` is reported as decoded
 * even when out of range; `valid` says whether it was inside 1-5.
 */
export interface RatingIssuedFact {
  type: 'RATING_ISSUED';
  txid: Txid;
  spentOutpoint: Outpoint;
  raterPkh: Pkh;
  rateePkh: Pkh;
  score: number;
  valid: boolean;
}

/**
 * SPEC-003 RF-06. An independent fact, not a modification of the Receipt.
 * `valid: false` when the referenced Receipt has not been indexed, which is a
 * claim this recognizer cannot corroborate rather than a proven falsehood.
 */
export interface PlatformConfirmationFact {
  type: 'PLATFORM_CONFIRMATION';
  txid: Txid;
  platformPkh: Pkh;
  receiptTxid: Txid;
  valid: boolean;
}

/** SPEC-006. Unilateral, so consent is impossible; self-trust is invalid. */
export interface TrustLinkFact {
  type: 'TRUST_LINK';
  txid: Txid;
  trusterPkh: Pkh;
  trustedPkh: Pkh;
  valid: boolean;
}

export type RepidFact =
  | IdentityGenesisFact
  | IdentityCollateralTopUpFact
  | IdentityBurnedFact
  | ReceiptGenesisFact
  | RatingIssuedFact
  | PlatformConfirmationFact
  | TrustLinkFact;

export type FactType = RepidFact['type'];

/**
 * A fact that this recognizer can assert to have found on chain. Downstream
 * code that must not act on an unverifiable claim filters on `valid`, which is
 * the difference between "recognized" and "true".
 */
export type ValidatedFact = Extract<RepidFact, { valid: true }>;

/** What is retained about a tracked identity between transactions. */
export interface IdentityRecord {
  ownerPkh: Pkh;
  identityCategory: Category;
  collateral: AmountString;
}

/** What is retained about a Receipt, so confirmations can be corroborated. */
export interface ReceiptRecord {
  receiptOwnerPkh: Pkh;
}

/** What a Rating Right entitles its holder to do, without naming it. */
export type RatingRightInfo = Omit<RatingRightRecord, 'outpoint'>;

/**
 * The state SPEC-005 requires a recognizer to retain.
 *
 * Retaining it is normative, but the *mechanism* is not: the protocol requires
 * that Rating Right outpoints be remembered so a later rating can be attributed
 * to the right parties, and that Receipt txids be remembered so a confirmation
 * can be checked. Whether that is a Map, a file or a database is an
 * implementation choice, which is why this is an interface.
 *
 * `trackRatingRight` takes the outpoint as the key and the rest of the record
 * separately, and the store builds the full record itself. Accepting the
 * outpoint in both places would let a caller store a record that contradicts
 * the key it was filed under, which is a wrong-fact generator that no type
 * checker can catch once both are `string`.
 *
 * `consumeRatingRight` exists because a Rating Right is single-use. Without it
 * the same outpoint can be recognized as rated more than once, which contradicts
 * the one-rating-per-participant property the burn is there to provide.
 */
export interface RepidStateStore {
  getRatingRight(outpoint: Outpoint): RatingRightRecord | undefined;
  trackRatingRight(outpoint: Outpoint, info: RatingRightInfo): void;
  consumeRatingRight(outpoint: Outpoint): void;

  getReceipt(txid: Txid): ReceiptRecord | undefined;
  trackReceipt(txid: Txid, record: ReceiptRecord): void;

  getIdentity(outpoint: Outpoint): IdentityRecord | undefined;
  trackIdentity(outpoint: Outpoint, record: IdentityRecord): void;
  untrackIdentity(outpoint: Outpoint): void;

  /** An inspectable view of the retained state, for debugging and tests. */
  snapshot(): RepidStateSnapshot;
}

export interface RepidStateSnapshot {
  ratingRights: Array<[Outpoint, RatingRightRecord]>;
  receipts: Array<[Txid, ReceiptRecord]>;
  identities: Array<[Outpoint, IdentityRecord]>;
}
