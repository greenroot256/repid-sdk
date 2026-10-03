// What this build is, and which protocol versions it is willing to speak.
//
// SPEC-010 requires an implementation to declare the set of protocol versions it
// implements, and forbids it from claiming a version it has not been verified
// against. This module is that declaration, and it is deliberately hand-written
// rather than derived from the bundled protocol file.
//
// Deriving the supported set from the file would make the check vacuous: the file
// arrives from `npm run sync:protocol`, so it always says whatever the protocol
// repository currently says, and a "supported" set built from it would agree with
// itself by construction. The point of declaring a version is to have something
// that can disagree with the file, so a protocol bump that nobody has reviewed
// here stops the build instead of passing silently.

import { PROTOCOL_NAME, PROTOCOL_VERSION } from './constants.js';

/**
 * The SDK's own version, which follows its own semver and is not required to
 * track the protocol version numerically (SPEC-010 §8).
 *
 * Written literally rather than read from `package.json`, because a runtime
 * import of a file outside `src/` fights the build's rootDir. A literal can
 * drift, so `test/sdk_version.test.ts` asserts it equals `package.json` — the
 * check the runtime cannot make becomes the check the test makes.
 */
export const SDK_VERSION = '0.1.0';

/**
 * The protocol versions this build implements, as stated by SPEC-010 §5.
 *
 * Only `0.2.0`, and the replacement of `0.1.0` is deliberate rather than an
 * oversight. SPEC-010 §4.1 records that during `0.y.z` a breaking change advances
 * `MINOR`, so `0.1.0` and `0.2.0` are *not* two readings of the same rules: from
 * `0.2.0` a receipt genesis naming one party as both of them is not recognized
 * (RF-W55), and it was recognized before. Keeping `0.1.0` in this list would
 * claim this recognizer can also read under the older rules, and it cannot — the
 * same bytes must produce different facts under the two versions, and only one
 * of them is what this code does.
 *
 * At a `MAJOR` boundary the arithmetic runs the other way: the historical fact
 * still has to be readable (SPEC-010 §7), so the earlier version is added
 * alongside the new one rather than replacing it, until no supported consumer
 * needs the old rules. That is not this bump.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['0.2.0'];

/**
 * Fails loudly when a protocol version is not one this build implements.
 *
 * "Loudly" means throwing, not warning and not degrading. An indexer that
 * continues under rules it does not implement produces facts that are wrong in
 * ways nothing downstream can detect, because a malformed fact and a
 * misinterpreted one are indistinguishable to whoever audits the result.
 */
export function assertSupportsProtocolVersion(version: string): void {
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    throw new Error(
      `@repid/sdk ${SDK_VERSION} does not implement ${PROTOCOL_NAME} protocol version ${version}. ` +
        `Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}. ` +
        'Do not claim a protocol version this build has not been verified against (SPEC-010 §5).',
    );
  }
}

/**
 * The version this build actually operates under, and it must be one it claims.
 *
 * This runs at load time on purpose. `PROTOCOL_VERSION` is read from the copy of
 * `protocol/protocol-version.json` that `sync-protocol.mjs` pulled out of the
 * protocol repository, so it changes when *that* repository is updated, not when
 * this one is. If a sync brings in a version this build never reviewed, the
 * recognizer refuses to load rather than reading transactions under rules
 * nothing here was written against.
 */
assertSupportsProtocolVersion(PROTOCOL_VERSION);
