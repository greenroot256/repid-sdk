// Does the recognizer actually distinguish a covenant from an impostor?
//
// This file is the proof of concept for closing the gap SPEC-009 §11 declared
// rather than solved:
//
//   "Recognition is shape-based, so it is spoofable by an issuer that can produce
//    the bytes. The covenant and the network's script execution are what make a
//    fact genuine; the indexer only reads what survived them."
//
// The technique matters more than the assertions. Each impostor here is produced
// by taking a genuine covenant spend and changing *one* thing about it, so the
// bytes still pass every shape check the recognizer has. That is what makes these
// cases worth having: they isolate the binding check from the shape checks
// instead of testing a transaction that was never legitimate to begin with.
//
// What is deliberately NOT claimed: this does not run the VM, and it does not
// prove a covenant's logic is correct. It proves that the script which produced a
// fact is byte-for-byte the canonical one, which is the part a shape check cannot
// do and the part an impostor cannot fake.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Contract,
  MockNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
} from 'cashscript';
import { binToHex, decodeTransactionBCH, encodeTransactionBCH, hash160, hash256 } from '@bitauth/libauth';
import {
  indexRawTransaction,
  createMemoryStore,
  decodeRawTransaction,
  hexToBytes,
} from '../src/index.js';
import {
  readP2SHHash,
  readRedeemScript,
  findFinalPush,
  buildExpectedScript,
  verifyVaultOutputBinding,
  verifyRedeemScriptBinding,
  type CanonicalCovenant,
} from '../src/covenant.js';
import vaultArtifact from './fixtures/identity_vault.json' with { type: 'json' };
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import bytecode from './fixtures/covenant-bytecode.json' with { type: 'json' };
import { makeParty, makeProvider, mockUtxo, unlocker, expectFact, type Party } from './helpers.js';

const provider: MockNetworkProvider = makeProvider();
let store = createMemoryStore();
let seedCounter = 0;

beforeEach(() => {
  provider.reset();
  store = createMemoryStore();
  seedCounter = 0;
});

const VAULT = bytecode.contracts.identityVault as CanonicalCovenant;
const RECEIPT = bytecode.contracts.receiptGenesis as CanonicalCovenant;
const CATEGORY = 'aa'.repeat(32);

// --- helpers ---------------------------------------------------------------

/** Re-encodes a transaction after a caller-supplied mutation. */
function mutate(hex: string, change: (tx: any) => void): string {
  const decoded = decodeTransactionBCH(Buffer.from(hex, 'hex'));
  if (typeof decoded === 'string' || decoded === null) {
    throw new Error(`could not decode: ${String(decoded)}`);
  }
  change(decoded);
  return Buffer.from(encodeTransactionBCH(decoded as any)).toString('hex');
}

/** The minimal push encoding of some data, as a scriptSig would emit it. */
function pushData(data: Uint8Array): Uint8Array {
  if (data.length <= 0x4b) {
    return new Uint8Array([data.length, ...data]);
  }
  if (data.length <= 0xff) {
    return new Uint8Array([0x4c, data.length, ...data]);
  }
  return new Uint8Array([0x4d, data.length & 0xff, (data.length >> 8) & 0xff, ...data]);
}

/** Replaces the final push of a scriptSig, which is the redeem script. */
function replaceRedeemScript(scriptSig: Uint8Array, impostor: Uint8Array): Uint8Array {
  const found = findFinalPush(scriptSig);
  if (!found) throw new Error('scriptSig had no final push');
  return new Uint8Array([...scriptSig.slice(0, found.opcodeAt), ...pushData(impostor)]);
}

async function mintIdentity(owner: Party, collateral = 1000n): Promise<string> {
  const contract = new Contract(vaultArtifact, [owner.pkh], { provider });
  const utxo = mockUtxo(CATEGORY, 10_000n);
  provider.addUtxo(contract.address, utxo);

  return (
    await new TransactionBuilder({ provider })
      .addInput(
        utxo,
        unlocker(contract, 'mint').mint!(
          owner.publicKey,
          new SignatureTemplate(owner.privateKey),
          collateral,
        ),
      )
      .addOutput({
        to: contract.tokenAddress,
        amount: collateral,
        token: {
          category: utxo.txid,
          amount: 0n,
          nft: { capability: 'none', commitment: binToHex(owner.pkh) },
        },
      })
      .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
      .send()
  ).hex;
}

async function mintReceipt(partyA: Party, partyB: Party): Promise<string> {
  const contract = new Contract(receiptArtifact, [partyA.pkh, partyB.pkh], { provider });
  const utxo = mockUtxo(CATEGORY, 10_000n);
  provider.addUtxo(contract.address, utxo);
  const nft = (commitment: string) => ({
    category: CATEGORY,
    amount: 0n,
    nft: { capability: 'none' as const, commitment },
  });

  return (
    await new TransactionBuilder({ provider })
      .addInput(
        utxo,
        unlocker(contract, 'mint').mint!(
          partyA.publicKey,
          new SignatureTemplate(partyA.privateKey),
          partyB.publicKey,
          new SignatureTemplate(partyB.privateKey),
        ),
      )
      .addOutput({ to: partyA.address, amount: 1000n, token: nft('') })
      .addOutput({ to: partyA.address, amount: 1000n, token: nft(binToHex(partyB.pkh)) })
      .addOutput({ to: partyB.address, amount: 1000n, token: nft(binToHex(partyA.pkh)) })
      .addBchChangeOutputIfNeeded({ to: partyA.address, feeRate: 1 })
      .send()
  ).hex;
}

// --- 0.5 no-regression: genuine covenant spends are bound --------------------

describe('a genuine covenant spend is bound to the canonical script', () => {
  it('recognizes the identity vault output as the canonical covenant', async () => {
    const owner = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintIdentity(owner));

    const result = verifyVaultOutputBinding(
      tx.outputs[0]!.lockingBytecode,
      binToHex(owner.pkh),
      VAULT,
    );

    expect(result.bound).toBe(true);
    // The output really is the CashTokens 32-byte-hash P2SH form.
    expect(readP2SHHash(tx.outputs[0]!.lockingBytecode)?.algorithm).toBe('hash256');
    expect(result.expectedScriptHash).toBe(
      binToHex(hash256(buildExpectedScript(VAULT, [binToHex(owner.pkh)]))),
    );
  });

  it('reveals the canonical redeem script on the vault input', async () => {
    const owner = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintIdentity(owner));
    const input = tx.inputs.find((i) => i.outpointIndex === 0)!;

    const result = verifyRedeemScriptBinding(
      input.unlockingBytecode,
      [binToHex(owner.pkh)],
      VAULT,
    );

    expect(result.bound).toBe(true);
    // 20 bytes of pushed ownerPkh plus 200 bytes of bytecode.
    expect(result.revealedLength).toBe(221);
  });

  it('reveals the canonical redeem script on the receipt input', async () => {
    const partyA = makeParty(++seedCounter);
    const partyB = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintReceipt(partyA, partyB));
    const input = tx.inputs.find((i) => i.outpointIndex === 0)!;

    const result = verifyRedeemScriptBinding(
      input.unlockingBytecode,
      [binToHex(partyA.pkh), binToHex(partyB.pkh)],
      RECEIPT,
    );

    expect(result.bound).toBe(true);
    // Two pushed pkh values plus 122 bytes of bytecode.
    expect(result.revealedLength).toBe(164);
  });

  it('pushes the constructor arguments in reverse declaration order', async () => {
    // The detail that a lenient implementation gets wrong, pinned by a test
    // because getting it wrong yields a different script hash and would make
    // every genuine Receipt look like an impostor.
    const partyA = makeParty(++seedCounter);
    const partyB = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintReceipt(partyA, partyB));
    const input = tx.inputs.find((i) => i.outpointIndex === 0)!;
    const revealed = readRedeemScript(input.unlockingBytecode)!;

    const body = RECEIPT.bytecodeHex;
    expect(binToHex(revealed)).toBe(`14${binToHex(partyB.pkh)}14${binToHex(partyA.pkh)}${body}`);
    // The declared order is a different script, and so a different hash.
    expect(binToHex(revealed)).not.toBe(`14${binToHex(partyA.pkh)}14${binToHex(partyB.pkh)}${body}`);
  });

  it('reads the long push form, which is what these scripts need', async () => {
    const owner = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintIdentity(owner));
    const input = tx.inputs.find((i) => i.outpointIndex === 0)!;
    const found = findFinalPush(input.unlockingBytecode)!;

    // The scriptSig is more than just the script: arguments, a signature, a
    // public key and an OP_0 precede it, which is why the reveal has to be
    // located rather than assumed to be the whole thing.
    expect(found.data.length).toBe(221);
    expect(found.opcodeAt).toBeGreaterThan(0);
    // A single-byte push opcode cannot express 221 bytes, so the compiler had to
    // reach for OP_PUSHDATA1, and the two-byte header proves the walk found a
    // real push rather than a coincidental offset.
    expect(input.unlockingBytecode[found.opcodeAt]).toBe(0x4c);
    expect(input.unlockingBytecode[found.start - 1]).toBe(221);
  });
});

// --- 0.6 impostors: shape still matches, binding does not --------------------

describe('an impostor that matches the shape is not bound', () => {
  it('reports a vault locked to a foreign P2SH as a valid identity today', async () => {
    // The vulnerability, stated as a passing test. Output 0 is replaced with a
    // P2SH the attacker chose the hash of. Every shape rule the recognizer has
    // still holds: 20-byte commitment equal to the owner, two outputs, tokenless
    // change back to the same owner.
    const owner = makeParty(++seedCounter);
    const forged = mutate(await mintIdentity(owner), (tx) => {
      const foreign = 'ab'.repeat(32);
      tx.outputs[0].lockingBytecode = hexToBytes(`aa20${foreign}87`);
    });

    // Today: recognized, with collateral, and nothing on the fact flags that
    // the covenant never ran. There is no validity field to set, which is why
    // the profile has to introduce one rather than reuse an existing marker.
    const fact = expectFact(indexRawTransaction(forged, store), 'IDENTITY_GENESIS');
    expect(fact.collateral).toBeDefined();
    expect(fact).not.toHaveProperty('valid');

    // After binding: rejected.
    const { tx } = decodeRawTransaction(forged);
    const result = verifyVaultOutputBinding(
      tx.outputs[0]!.lockingBytecode,
      binToHex(owner.pkh),
      VAULT,
    );
    expect(result.bound).toBe(false);
    expect(result.reason).toBe('script-hash-differs');
    expect(result.foundScriptHash).toBe('ab'.repeat(32));
  });

  it('reports a receipt whose covenant was never run as a valid receipt today', async () => {
    const partyA = makeParty(++seedCounter);
    const partyB = makeParty(++seedCounter);
    const genuine = await mintReceipt(partyA, partyB);

    // The covenant input is replaced by a spend of an attacker's own script. The
    // three NFT outputs are untouched, so the whole shape still matches and the
    // cross pair of commitments still checks out.
    const forged = mutate(genuine, (tx) => {
      tx.inputs[0].unlockingBytecode = replaceRedeemScript(
        tx.inputs[0].unlockingBytecode,
        hexToBytes('51'.repeat(100)),
      );
    });

    const fact = expectFact(indexRawTransaction(forged, store), 'RECEIPT_GENESIS');
    expect(fact.ratingRights).toHaveLength(2);

    const { tx } = decodeRawTransaction(forged);
    const result = verifyRedeemScriptBinding(
      tx.inputs[0]!.unlockingBytecode,
      [binToHex(partyA.pkh), binToHex(partyB.pkh)],
      RECEIPT,
    );
    expect(result.bound).toBe(false);
    expect(result.reason).toBe('redeem-script-differs');
  });

  it('rejects a P2PKH output as a vault, which a hash check alone would miss', () => {
    // Guards the reason code itself: a 25-byte P2PKH is not "a P2SH with the
    // wrong hash", it is not P2SH at all, and the two failures must stay
    // distinguishable in the fact that gets reported.
    const owner = makeParty(++seedCounter);
    const p2pkh = hexToBytes(`76a914${binToHex(owner.pkh)}88ac`);
    const result = verifyVaultOutputBinding(p2pkh, binToHex(owner.pkh), VAULT);
    expect(result.bound).toBe(false);
    expect(result.reason).toBe('output-is-not-p2sh');
  });

  it('does not accept a receipt whose covenant was instantiated for other parties', async () => {
    // The covenant enforces joint signature over *its own* constructor
    // arguments. A script that is the canonical bytecode but carries a different
    // partyA is a different contract, and would have demanded signatures from
    // different keys, so binding on the arguments matters as much as binding on
    // the program.
    const partyA = makeParty(++seedCounter);
    const partyB = makeParty(++seedCounter);
    const stranger = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintReceipt(partyA, partyB));
    const input = tx.inputs.find((i) => i.outpointIndex === 0)!;

    const result = verifyRedeemScriptBinding(
      input.unlockingBytecode,
      [binToHex(stranger.pkh), binToHex(partyB.pkh)],
      RECEIPT,
    );
    expect(result.bound).toBe(false);
    expect(result.reason).toBe('redeem-script-differs');
  });

  it('rejects a scriptSig whose last push is the covenant body without its args', async () => {
    // The body alone is the canonical bytecode and would pass any check that
    // only compared the program. Without the constructor arguments the script is
    // a different, and much weaker, contract.
    const partyA = makeParty(++seedCounter);
    const partyB = makeParty(++seedCounter);
    const { tx } = decodeRawTransaction(await mintReceipt(partyA, partyB));
    const input = tx.inputs.find((i) => i.outpointIndex === 0)!;
    const forged = replaceRedeemScript(input.unlockingBytecode, hexToBytes(RECEIPT.bytecodeHex));

    const result = verifyRedeemScriptBinding(
      forged,
      [binToHex(partyA.pkh), binToHex(partyB.pkh)],
      RECEIPT,
    );
    expect(result.bound).toBe(false);
    expect(result.reason).toBe('redeem-script-differs');
  });

  it('reports a scriptSig with no final push instead of guessing at its tail', () => {
    // The scriptSig ends in OP_0, so no push runs to the end of it and there is
    // no redeem script to be had. A truncated push header is treated the same
    // way rather than being read as a zero-length push.
    expect(
      verifyRedeemScriptBinding(
        new Uint8Array([0x14, ...hexToBytes('ab'.repeat(20)), 0x00]),
        ['ab'.repeat(20)],
        VAULT,
      ).reason,
    ).toBe('no-redeem-script-revealed');
    expect(
      verifyRedeemScriptBinding(new Uint8Array([0x4c, 0xdd, 0x01]), ['ab'.repeat(20)], VAULT).reason,
    ).toBe('no-redeem-script-revealed');
    expect(verifyRedeemScriptBinding(new Uint8Array(0), ['ab'.repeat(20)], VAULT).reason).toBe(
      'no-redeem-script-revealed',
    );
  });
});

// --- the deployed script is not a constant ----------------------------------

describe('every instance has its own script hash', () => {
  it('differs per owner, which is why the expected script is rebuilt', () => {
    const one = makeParty(++seedCounter);
    const two = makeParty(++seedCounter);

    const a = buildExpectedScript(VAULT, [binToHex(one.pkh)]);
    const b = buildExpectedScript(VAULT, [binToHex(two.pkh)]);

    expect(a).not.toEqual(b);
    // 1 push opcode + 20 argument bytes + 200 of bytecode.
    expect(a.length).toBe(221);
  });

  it('accepts the classic 23-byte P2SH form as well as the CashTokens one', () => {
    // A vault locked with the OP_HASH160 form is still a genuine vault, so the
    // check has to follow the form the output actually uses.
    const owner = makeParty(++seedCounter);
    const script = buildExpectedScript(VAULT, [binToHex(owner.pkh)]);
    const classic = hexToBytes(`a914${binToHex(hash160(script))}87`);

    expect(readP2SHHash(classic)?.algorithm).toBe('hash160');
    expect(verifyVaultOutputBinding(classic, binToHex(owner.pkh), VAULT).bound).toBe(true);
    // The same 20-byte hash under the 32-byte form does not match, because the
    // form dictates the algorithm.
    expect(verifyVaultOutputBinding(hexToBytes(`aa20${binToHex(hash160(script))}87`), binToHex(owner.pkh), VAULT).bound).toBe(
      false,
    );
  });

  it('refuses to build a script when an argument is missing or mistyped', () => {
    expect(() => buildExpectedScript(VAULT, [])).toThrow(/arity/);
    expect(() => buildExpectedScript(VAULT, ['not-hex'])).toThrow(/20 bytes/);
    expect(() =>
      buildExpectedScript(
        { bytecodeHex: '00', constructorInputs: [{ name: 'x', type: 'int' }] },
        ['00'.repeat(20)],
      ),
    ).toThrow(/unsupported constructor type/);
  });
});
