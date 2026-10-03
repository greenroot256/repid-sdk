// Fact recognition: decide whether a transaction is one of the seven RepID
// facts, and if so say which and extract its data.
//
// The scope of this module is deliberately narrow. It does not re-validate
// covenant rules: the network already did that when the transaction was mined.
// It recognizes shapes and attributes them. Anything that requires a judgement
// about meaning -- how much a rating is worth, whether two interactions were
// really comparable -- belongs to the interpretation layer, which is not this
// repository's job.
//
// Recognition has exactly three possible outcomes, and collapsing any two of
// them is the characteristic bug of a RepID recognizer:
//
//   1. a fact, possibly with `valid: false`
//   2. not a RepID transaction at all -> null
//   3. an undecodable transaction -> throw
//
// A rating whose score is out of range is case 1 with `valid: false`, never case
// 2. Silently discarding it would erase the record that someone tried.
//
// There is a fourth outcome once binding verification is switched on, and it is
// also case 2: a transaction with the right shape that did not come from the
// canonical covenant. That is a rejection, not a fact marked `valid: false`,
// because `valid: false` already means "recognized but broke a semantic rule" and
// a consumer could not otherwise tell the two apart (SPEC-009 RF-W49).

import { extractP2PKH, extractPkhFromUnlocking, parseOpReturn, toHex } from './bytes.js';
import { MIN_SCORE, MAX_SCORE, OP_RETURN_TAGS } from './constants.js';
import {
  verifyRedeemScriptBinding,
  verifyVaultOutputBinding,
  type CanonicalCovenant,
} from './covenant.js';
import covenantBytecode from './protocol/covenant-bytecode.json' with { type: 'json' };
import {
  categoryAppearsInOutputs,
  decodeRawTransaction,
  findOpReturnOutput,
  type DecodedTransaction,
  type TransactionOutput,
} from './transaction.js';
import type {
  IdentityGenesisFact,
  PlatformConfirmationFact,
  RatingIssuedFact,
  RatingRightRecord,
  ReceiptGenesisFact,
  RepidFact,
  RepidStateStore,
  TrustLinkFact,
} from './types.js';

/**
 * The canonical covenants, synced from the protocol repository.
 *
 * Binding cannot be done without them and cannot be done from the chain: the
 * expected script is a compiler output, so an implementation that wants to verify
 * binding has to be shipped the bytes it is verifying against. Reconstructing
 * them from the transaction under inspection would prove nothing, which is why
 * these are a synced normative input and not something read off the wire.
 */
const VAULT = covenantBytecode.contracts.identityVault as CanonicalCovenant;
const RECEIPT = covenantBytecode.contracts.receiptGenesis as CanonicalCovenant;

/** How strictly to recognize. The default is unchanged, shape-only recognition. */
export interface RecognitionOptions {
  /**
   * Verify that a covenant-backed fact was produced by the canonical covenant,
   * and emit no fact when it was not (SPEC-009 §12).
   *
   * Off by default, and the default is not a fallback: an implementation that
   * never sets this makes no claim about identities at all, only about shapes
   * (SPEC-008 RF-V12). Turning it on makes this recognizer return *fewer* facts,
   * because it rejects impostors that shape recognition alone would report.
   */
  binding?: boolean;
}

/** Reads the pkh of a P2PKH output, or null if it is not one. */
function pkhOf(output: TransactionOutput | undefined): string | null {
  if (!output) return null;
  return extractP2PKH(output.lockingBytecode);
}

/**
 * SPEC-001. Two recognized genesis shapes.
 *
 * LEGACY: one or two outputs, the NFT has capability `none` and no fungibles,
 * locked to a plain P2PKH. A second output carrying a token is not the expected
 * change, so it is not a genesis.
 *
 * VAULT: two outputs, the NFT (capability `none`, commitment = ownerPkh, no
 * fungibles) locked to the covenant rather than to a P2PKH, and a tokenless P2PKH
 * change back to the owner. The covenant outpoint is returned so a later top-up
 * or burn can be recognized.
 */
function recognizeIdentityGenesis(
  tx: DecodedTransaction,
  txid: string,
): IdentityGenesisFact | null {
  const outCount = tx.outputs.length;
  if (outCount !== 1 && outCount !== 2) return null;

  const out = tx.outputs[0];
  if (!out?.token?.nft) return null;
  if (out.token.nft.capability !== 'none') return null;
  if (out.token.amount !== 0n) return null;
  if (outCount === 2 && tx.outputs[1]?.token) return null;

  const category = toHex(out.token.category);

  const legacyOwnerPkh = pkhOf(out);
  if (legacyOwnerPkh) {
    return { type: 'IDENTITY_GENESIS', txid, identityCategory: category, ownerPkh: legacyOwnerPkh };
  }

  // VAULT shape. The covenant is a P2SH, so its bytecode is not on-chain; the
  // identity is bound to its owner by the NFT commitment instead.
  const commitment = out.token.nft.commitment;
  if (!commitment || commitment.length !== 20) return null;
  const vaultOwnerPkh = toHex(commitment);
  if (outCount !== 2) return null;

  // The change must return to the identity's own owner, which is what makes the
  // commitment checkable rather than a bare assertion.
  if (pkhOf(tx.outputs[1]) !== vaultOwnerPkh) return null;

  return {
    type: 'IDENTITY_GENESIS',
    txid,
    identityCategory: category,
    ownerPkh: vaultOwnerPkh,
    collateral: out.valueSatoshis.toString(),
    identityOutpoint: `${txid}:0`,
  };
}

/**
 * The outcome of looking through a transaction's inputs for a tracked vault
 * outpoint.
 *
 * `none` and `rejected` both yield no fact, but they are not the same answer and
 * conflating them is a real hazard: a top-up re-emits the NFT with the same shape
 * as a genesis, so a rejected spend that falls through to genesis recognition is
 * re-read as a brand new identity, and the store ends up tracking an identity that
 * no covenant ever created. `rejected` has to end the transaction where `none`
 * lets it continue.
 */
type SpendOutcome =
  | { kind: 'fact'; fact: RepidFact }
  | { kind: 'none' }
  | { kind: 'rejected' };

/**
 * SPEC-001. The spend of a tracked vault identity, keyed by covenant outpoint.
 *
 * The category not reappearing in any output means the NFT was burned, so the
 * identity is over and the collateral returned to the owner. The category
 * reappearing means the covenant re-locked itself: that is a top-up, and it is
 * valid only if the same NFT came back and the collateral did not decrease.
 *
 * Tracking moves to the new outpoint on success. A collateral decrease is
 * recorded as `valid: false` and leaves the previous tracking in place, because
 * such a transaction cannot be mined: the covenant rejected it. The state is
 * left as it was rather than advanced to a value the chain never accepted.
 */
function recognizeIdentitySpend(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
  binding: boolean,
): SpendOutcome {
  for (const input of tx.inputs) {
    const outpoint = `${toHex(input.outpointTransactionHash)}:${input.outpointIndex}`;
    const identity = store.getIdentity(outpoint);
    if (!identity) continue;

    const { identityCategory: category, ownerPkh } = identity;

    // The spend reveals its redeem script, and that script has to be the vault's.
    // Checked here, before any of the tracking below moves, because the
    // alternatives are worse: an impostor would otherwise be recorded as a
    // genuine top-up and the collateral would move to an outpoint the covenant
    // never controls.
    //
    // A tracked outpoint released with the wrong script is not an identity spend
    // at all, and it ends the transaction. Letting recognition continue would let
    // another input, or the top-up's own re-emitted NFT, still produce a fact —
    // which would make the rejection depend on input order.
    if (binding) {
      const result = verifyRedeemScriptBinding(input.unlockingBytecode, [ownerPkh], VAULT);
      if (!result.bound) return { kind: 'rejected' };
    }

    if (!categoryAppearsInOutputs(tx, category)) {
      store.untrackIdentity(outpoint);
      return {
        kind: 'fact',
        fact: {
          type: 'IDENTITY_BURNED',
          txid,
          identityCategory: category,
          ownerPkh,
          spentOutpoint: outpoint,
          valid: true,
        },
      };
    }

    const out0 = tx.outputs[0];
    const hasSameNft =
      !!out0?.token &&
      toHex(out0.token.category) === category &&
      out0.token.amount === 0n &&
      !!out0.token.nft &&
      out0.token.nft.commitment !== undefined &&
      out0.token.nft.commitment !== null &&
      toHex(out0.token.nft.commitment) === ownerPkh;

    const previousCollateral = BigInt(identity.collateral);
    const collateral = BigInt(out0?.valueSatoshis ?? 0n);
    const valid = hasSameNft && collateral >= previousCollateral;

    if (valid) {
      store.untrackIdentity(outpoint);
      store.trackIdentity(`${txid}:0`, {
        ownerPkh,
        identityCategory: category,
        collateral: collateral.toString(),
      });
    }

    return {
      kind: 'fact',
      fact: {
        type: 'IDENTITY_COLLATERAL_TOP_UP',
        txid,
        identityCategory: category,
        ownerPkh,
        spentOutpoint: outpoint,
        previousCollateral: previousCollateral.toString(),
        collateral: collateral.toString(),
        valid,
      },
    };
  }
  return { kind: 'none' };
}

/**
 * SPEC-003 and SPEC-004. Three or four outputs sharing one category: output 0 is
 * the Receipt with an empty commitment, outputs 1 and 2 are Rating Rights with a
 * non-empty commitment each, locked to two different P2PKHs. A fourth tokenless
 * P2PKH change output is optional; a fourth output carrying a token is not the
 * expected change and is not recognized.
 *
 * Each Rating Right's commitment names the *other* party, which is what ties a
 * later rating to a counterparty without anyone having to trust this code.
 */
function recognizeReceiptGenesis(
  tx: DecodedTransaction,
  txid: string,
): ReceiptGenesisFact | null {
  const outCount = tx.outputs.length;
  if (outCount !== 3 && outCount !== 4) return null;
  if (outCount === 4 && tx.outputs[3]?.token) return null;

  const [receipt, rrA, rrB] = tx.outputs;
  if (!receipt || !rrA || !rrB) return null;

  const outs = [receipt, rrA, rrB];
  if (outs.some((o) => !o.token?.nft || o.token.amount !== 0n)) return null;
  // RF-W39 requires capability `none` on all three, and the identity path already
  // enforces it. A `mutable` or `minting` NFT in a receipt genesis would let the
  // category be reissued after the fact, which is the opposite of what a Receipt
  // claims to be, so the shape is rejected rather than accepted as a variant.
  if (outs.some((o) => o.token!.nft!.capability !== 'none')) return null;

  const category = toHex(receipt.token!.category);
  if (outs.some((o) => toHex(o.token!.category) !== category)) return null;

  const isEmpty = (bytes: Uint8Array | null | undefined): boolean =>
    !bytes || bytes.length === 0;

  if (!isEmpty(receipt.token!.nft!.commitment)) return null;
  if (isEmpty(rrA.token!.nft!.commitment) || isEmpty(rrB.token!.nft!.commitment)) return null;

  const receiptOwnerPkh = pkhOf(receipt);
  const partyAPkh = pkhOf(rrA);
  const partyBPkh = pkhOf(rrB);
  if (!receiptOwnerPkh || !partyAPkh || !partyBPkh) return null;

  const partyARates = toHex(rrA.token!.nft!.commitment!);
  const partyBRates = toHex(rrB.token!.nft!.commitment!);

  // Each right references the other party. Checking this is what makes the pair
  // of commitments meaningful rather than decorative.
  if (partyARates !== partyBPkh || partyBRates !== partyAPkh) return null;

  return {
    type: 'RECEIPT_GENESIS',
    txid,
    receiptCategory: category,
    receiptOwnerPkh,
    ratingRights: [
      { outpoint: `${txid}:1`, ownerPkh: partyAPkh, ratesPkh: partyBPkh },
      { outpoint: `${txid}:2`, ownerPkh: partyBPkh, ratesPkh: partyAPkh },
    ],
  };
}

/**
 * SPEC-004. A flat P2PKH spend of an already-tracked Rating Right, carrying an
 * OP_RETURN with the tag and a one-byte score. The NFT does not reappear in any
 * output, so it is burned by being spent: that is precisely what enforces one
 * rating per participant at the UTXO level, with no covenant needed.
 *
 * An out-of-range score is still recognized, marked `valid: false`. The rating
 * happened; whether it counts is the interpretation layer's decision, not this
 * module's.
 */
function recognizeRatingIssued(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
): RatingIssuedFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== OP_RETURN_TAGS.RATING) return null;
  if (payload.chunks.length !== 2) return null;

  const scoreChunk = payload.chunks[1];
  if (!scoreChunk || scoreChunk.length !== 1) return null;
  const score = scoreChunk[0] as number;

  const validScore = score >= MIN_SCORE && score <= MAX_SCORE;

  for (const input of tx.inputs) {
    const outpoint = `${toHex(input.outpointTransactionHash)}:${input.outpointIndex}`;
    const ratingRight = store.getRatingRight(outpoint);
    if (!ratingRight) continue;

    // The Rating Right is single-use, and this transaction spent it: the NFT
    // appears in no output, so it is burned. Retiring the outpoint is a
    // statement about the chain, not about the rating, so it happens for an
    // out-of-range score exactly as it does for a good one. Leaving it tracked
    // would let the same right be recognized as rated more than once, which
    // contradicts the one-rating-per-participant property the burn exists to
    // provide.
    store.consumeRatingRight(outpoint);

    return {
      type: 'RATING_ISSUED',
      txid,
      spentOutpoint: outpoint,
      raterPkh: ratingRight.ownerPkh,
      rateePkh: ratingRight.ratesPkh,
      score,
      valid: validScore,
    };
  }

  return null;
}

/**
 * SPEC-003 RF-06. A validating entity corroborates that an interaction happened
 * by spending one of its own P2PKH UTXOs with an OP_RETURN naming the Receipt's
 * txid. The confirmation is a separate fact; it does not modify the Receipt.
 *
 * A confirmation naming a Receipt this recognizer has not indexed is reported
 * with `valid: false`. That is not a claim of falsehood: it is a claim this
 * recognizer cannot corroborate, and the distinction matters to anyone deciding
 * how much weight to give it.
 */
function recognizePlatformConfirmation(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
): PlatformConfirmationFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== OP_RETURN_TAGS.PLATFORM) return null;
  if (payload.chunks.length !== 2) return null;

  const receiptTxidChunk = payload.chunks[1];
  if (!receiptTxidChunk || receiptTxidChunk.length !== 32) return null;

  // The confirming entity is whoever signed: its pkh comes from the P2PKH
  // scriptSig of the first input, so no Identity is required to confirm.
  const platformPkh = extractPkhFromUnlocking(tx.inputs[0]?.unlockingBytecode);
  if (!platformPkh) return null;

  const receiptTxid = toHex(receiptTxidChunk);
  return {
    type: 'PLATFORM_CONFIRMATION',
    txid,
    platformPkh,
    receiptTxid,
    valid: Boolean(store.getReceipt(receiptTxid)),
  };
}

/**
 * SPEC-006. A unilaterally declares that it trusts B, spending one of A's own
 * P2PKH UTXOs with an OP_RETURN carrying B's pkh. No Rating Rights are minted
 * and B never consents, which is what makes this usable to address a cold start:
 * an identity with no ratings can still be endorsed.
 *
 * A trusting itself is reported with `valid: false`.
 */
function recognizeTrustLink(tx: DecodedTransaction, txid: string): TrustLinkFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== OP_RETURN_TAGS.TRUST) return null;
  if (payload.chunks.length !== 2) return null;

  const trustedChunk = payload.chunks[1];
  if (!trustedChunk || trustedChunk.length !== 20) return null;

  const trusterPkh = extractPkhFromUnlocking(tx.inputs[0]?.unlockingBytecode);
  if (!trusterPkh) return null;

  const trustedPkh = toHex(trustedChunk);
  return {
    type: 'TRUST_LINK',
    txid,
    trusterPkh,
    trustedPkh,
    valid: trustedPkh !== trusterPkh,
  };
}

/**
 * Recognizes one raw RepID transaction.
 *
 * @param rawTxHex - transaction hex, with or without a `0x` prefix.
 * @param store - retained state. Rating Right outpoints and Receipt txids
 * accumulated by earlier transactions are what let a rating be attributed to
 * the right parties and a confirmation be checked; the store is updated as a
 * side effect of recognizing the transaction.
 * @param options - pass `binding: true` to verify covenant linkage (SPEC-009
 * §12). Off by default.
 * @returns the recognized fact, or `null` if the transaction matches no known
 * RepID shape — or, with binding on, if it matches the shape of a
 * covenant-backed fact without having come from the covenant. Throws if the hex
 * cannot be decoded, because a transaction that cannot be read is not the same
 * as a transaction that is not a fact.
 *
 * The order below is the recognition precedence and is normative: a vault spend
 * is examined before a genesis because a top-up re-emits the NFT toward the
 * covenant with the same shape as a genesis, and only the outpoint trail
 * distinguishes the two.
 *
 * Every binding check runs *before* this function touches the store. That ordering
 * is the whole point: a rejected transaction must leave no trace, or the index
 * would end up holding an identity or a Rating Right that no covenant ever
 * created.
 */
export function indexRawTransaction(
  rawTxHex: string,
  store: RepidStateStore,
  options: RecognitionOptions = {},
): RepidFact | null {
  const { txid, tx } = decodeRawTransaction(rawTxHex);
  const binding = options.binding === true;

  const identitySpend = recognizeIdentitySpend(tx, txid, store, binding);
  if (identitySpend.kind === 'fact') return identitySpend.fact;
  if (identitySpend.kind === 'rejected') return null;

  const identityGenesis = recognizeIdentityGenesis(tx, txid);
  if (identityGenesis) {
    // Only the vault form is bound. A legacy genesis has no covenant in it at
    // all, so there is nothing to compare and nothing to reject: it stays a
    // recognized fact and, because it is never tracked, it never becomes an
    // identity (SPEC-008 RF-V13, SPEC-009 RF-W53).
    if (binding && identityGenesis.identityOutpoint) {
      const result = verifyVaultOutputBinding(
        tx.outputs[0]!.lockingBytecode,
        identityGenesis.ownerPkh,
        VAULT,
      );
      if (!result.bound) return null;
    }
    if (identityGenesis.identityOutpoint) {
      store.trackIdentity(identityGenesis.identityOutpoint, {
        ownerPkh: identityGenesis.ownerPkh,
        identityCategory: identityGenesis.identityCategory,
        collateral: identityGenesis.collateral ?? '0',
      });
    }
    return identityGenesis;
  }

  const receipt = recognizeReceiptGenesis(tx, txid);
  if (receipt) {
    if (binding) {
      // The genesis input, at vout 0 of its source: that is where the covenant
      // reveals itself, and it is also the input whose outpoint txid becomes the
      // category.
      const genesisInput = tx.inputs.find((input) => input.outpointIndex === 0);
      const result = genesisInput
        ? verifyRedeemScriptBinding(
            genesisInput.unlockingBytecode,
            receipt.ratingRights.map((right) => right.ownerPkh),
            RECEIPT,
          )
        : null;
      if (!result?.bound) return null;
    }
    for (const right of receipt.ratingRights) {
      store.trackRatingRight(right.outpoint, right as RatingRightRecord);
    }
    store.trackReceipt(txid, { receiptOwnerPkh: receipt.receiptOwnerPkh });
    return receipt;
  }

  const rating = recognizeRatingIssued(tx, txid, store);
  if (rating) return rating;

  const confirmation = recognizePlatformConfirmation(tx, txid, store);
  if (confirmation) return confirmation;

  return recognizeTrustLink(tx, txid);
}
