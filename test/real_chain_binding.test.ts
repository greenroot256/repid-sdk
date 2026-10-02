// Covenant binding against the real Chipnet run.
//
// The synthetic tests in covenant_binding.test.ts prove the binding check has
// teeth, but they build their transactions with the same toolchain that defines
// the check. That is a closed loop: it cannot catch the check being wrong about
// the toolchain. This file closes it by running the check over transactions that
// were compiled, broadcast and accepted by a BCH node that had no part in
// writing it.
//
// Two properties are asserted for each real transaction:
//
//   * base recognition still produces the fact the protocol fixture recorded,
//     which is the non-regression half and would break if the byte layout
//     assumptions in covenant.ts were wrong;
//   * every fact that has a covenant behind it binds to the canonical one.
//
// The ratings are the control. They are plain P2PKH spends with an OP_RETURN and
// have no covenant, so requiring binding on them would be a false rejection. If
// this file ever asserts that they bind, the profile has overreached.

import { describe, it, expect, beforeEach } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import {
  indexRawTransaction,
  createMemoryStore,
  decodeRawTransaction,
  toHex,
  verifyVaultOutputBinding,
  verifyRedeemScriptBinding,
  type RepidStateStore,
  type RepidFact,
  type CanonicalCovenant,
} from '../src/index.js';
import bytecode from './fixtures/covenant-bytecode.json' with { type: 'json' };
import chain from './fixtures/real-chain-txs.json' with { type: 'json' };

const VAULT = bytecode.contracts.identityVault as CanonicalCovenant;
const RECEIPT = bytecode.contracts.receiptGenesis as CanonicalCovenant;

const TRANSACTIONS = chain.transactions as {
  txid: string;
  type: string;
  bytes: number;
  hex: string;
}[];

const ratings = () => TRANSACTIONS.filter((t) => t.type === 'RATING_ISSUED');

let store: RepidStateStore;

beforeEach(() => {
  store = createMemoryStore();
});

/** Indexes one transaction and checks it produced the fact type recorded for it. */
function indexOne<T extends RepidFact['type']>(
  tx: { txid: string; type: string; hex: string },
  as: T,
): Extract<RepidFact, { type: T }> {
  const fact = indexRawTransaction(tx.hex, store);
  expect(fact, `${tx.txid} was not recognized`).not.toBeNull();
  expect(fact!.type, `${tx.txid} was recognized as the wrong fact type`).toBe(tx.type);
  return fact as Extract<RepidFact, { type: T }>;
}

/**
 * Replays the run in chain order up to and including `txid`, and returns the fact
 * that transaction produced.
 *
 * The replay is not optional bookkeeping. The index is stateful: a rating only
 * resolves against a Rating Right that an earlier receipt genesis put in the
 * index. `beforeEach` hands every test a fresh store, so any test touching a
 * rating has to rebuild the history that makes the rating meaningful. Indexing
 * out of order would silently yield a different answer, which is why the vectors
 * are stored in chain order and the protocol repository asserts it.
 */
function replayThrough<T extends RepidFact['type']>(txid: string, as: T) {
  const at = TRANSACTIONS.findIndex((t) => t.txid === txid);
  expect(at, `${txid} is not one of the vectors`).toBeGreaterThanOrEqual(0);

  let produced: RepidFact | null = null;
  for (const tx of TRANSACTIONS.slice(0, at + 1)) {
    produced = indexOne(tx, tx.type as RepidFact['type']);
  }
  return produced as Extract<RepidFact, { type: T }>;
}

describe('the real Chipnet run', () => {
  it('records five transactions that cover three fact types', () => {
    // Guards the premise of every assertion below. If the vectors are swapped
    // for synthetic ones, this fails and the file stops claiming chain evidence.
    expect(TRANSACTIONS).toHaveLength(5);
    expect(chain.provenance.network).toBe('chipnet');
    expect(new Set(TRANSACTIONS.map((t) => t.type))).toEqual(
      new Set(['IDENTITY_GENESIS', 'RECEIPT_GENESIS', 'RATING_ISSUED']),
    );
    for (const tx of TRANSACTIONS) {
      expect(tx.hex.length / 2, `${tx.txid} byte count`).toBe(tx.bytes);
    }
  });

  it('recognizes both identity genesis transactions and binds each to the vault', () => {
    const identities = TRANSACTIONS.filter((t) => t.type === 'IDENTITY_GENESIS');
    expect(identities).toHaveLength(2);

    const owners = new Set<string>();
    for (const tx of identities) {
      const fact = replayThrough(tx.txid, 'IDENTITY_GENESIS');
      const { tx: decoded } = decodeRawTransaction(tx.hex);

      const result = verifyVaultOutputBinding(
        decoded.outputs[0]!.lockingBytecode,
        fact.ownerPkh,
        VAULT,
      );

      // The commitment and the covenant agree on the owner, which is the
      // property that makes the comparison possible at all.
      expect(result.bound, `${tx.txid} did not bind: ${result.reason}`).toBe(true);
      expect(result.expectedScriptHash).toBe(result.foundScriptHash);
      owners.add(fact.ownerPkh);
    }

    // Two distinct owners, so the two matches are not one script matched twice.
    expect(owners.size).toBe(2);
  });

  it('recognizes the receipt genesis and binds it to the receipt covenant', () => {
    const tx = TRANSACTIONS.find((t) => t.type === 'RECEIPT_GENESIS')!;
    const fact = replayThrough(tx.txid, 'RECEIPT_GENESIS');
    const { tx: decoded } = decodeRawTransaction(tx.hex);

    // The covenant requires the genesis input to be vout 0 of its source, which
    // is also the input whose outpoint txid becomes the token category.
    const input = decoded.inputs.find((i) => i.outpointIndex === 0);
    expect(input, 'no input at vout 0').toBeDefined();

    const result = verifyRedeemScriptBinding(
      input!.unlockingBytecode,
      [fact.ratingRights[0]!.ownerPkh, fact.ratingRights[1]!.ownerPkh],
      RECEIPT,
    );

    expect(result.bound, `${tx.txid} did not bind: ${result.reason}`).toBe(true);
    // 122 bytes of bytecode plus two pushed 20-byte pkh values and their two
    // push opcodes. A real node accepted this exact script.
    expect(result.revealedLength).toBe(164);
  });

  it('recognizes both ratings, which have no covenant to bind to', () => {
    const ratings = TRANSACTIONS.filter((t) => t.type === 'RATING_ISSUED');
    expect(ratings).toHaveLength(2);

    for (const tx of ratings) {
      const fact = replayThrough(tx.txid, 'RATING_ISSUED');
      // A rating is the control case for the profile: it is a plain P2PKH spend
      // with an OP_RETURN and no covenant behind it, so a profile that demanded
      // binding here would be rejecting a legitimate RepID fact. Only the
      // resolution against the Rating Right is asserted.
      expect(fact.valid, `${tx.txid} did not resolve against its Rating Right`).toBe(true);
      expect(fact.score).toBeGreaterThanOrEqual(1);
      expect(fact.score).toBeLessThanOrEqual(5);
    }
  });

  it('reproduces the scores the protocol fixture recorded', () => {
    // The protocol repository holds the facts its reference implementation
    // concluded. Re-deriving them here is the point of keeping the raw bytes:
    // the two implementations can be compared without trusting either.
    const scores = ratings().map((tx) => replayThrough(tx.txid, 'RATING_ISSUED').score);
    // From real-chain-facts.json: 2 and 3.
    expect(scores.sort()).toEqual([2, 3]);
  });

  it('leaves the identity NFT committed to the owner the vault covenant holds', () => {
    // A last consistency check that costs nothing and would catch a decoder that
    // mixed up the two views of the same owner: the NFT commitment, the covenant
    // argument and the change output all have to name the same party.
    const tx = TRANSACTIONS.find((t) => t.type === 'IDENTITY_GENESIS')!;
    const fact = replayThrough(tx.txid, 'IDENTITY_GENESIS');
    const { tx: decoded } = decodeRawTransaction(tx.hex);

    expect(toHex(decoded.outputs[0]!.token!.nft!.commitment!)).toBe(fact.ownerPkh);
    // The change is tokenless BCH to the same owner, which is what makes the
    // genesis a two-output shape in the first place.
    expect(decoded.outputs[1]!.token).toBeUndefined();
    expect(binToHex(decoded.outputs[1]!.lockingBytecode)).toBe(
      `76a914${fact.ownerPkh}88ac`,
    );
  });
});
