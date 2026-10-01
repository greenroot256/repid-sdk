// SPEC-010 §5: declaring which protocol versions an implementation implements.
//
// The requirement is small and easy to satisfy performatively, by exporting a
// list copied from whatever the protocol repository currently says. That version
// of it is worthless: the list would agree with the bundled file by
// construction, so no change could ever be caught. The tests below are written
// against the property that makes the declaration mean something — an
// unreviewed version must be rejected.

import { describe, it, expect } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  SDK_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  assertSupportsProtocolVersion,
} from '../src/index.js';

describe('implemented version declaration (SPEC-010 section 5)', () => {
  it('keeps SDK_VERSION equal to the published package version', () => {
    // The constant is a literal so it can be compared against the bundled
    // protocol file without a rootDir violation. That makes drift possible, so
    // the check the runtime cannot perform is performed here instead.
    expect(SDK_VERSION).toBe(packageJson.version);
  });

  it('declares the protocol version this build actually operates under', () => {
    // This is the load-time guard in src/version.ts: importing the SDK at all
    // proves the assertion passes for the bundled version. Asserting it here too
    // means a failure is reported against this test rather than surfacing as an
    // unrelated import error somewhere else in the suite.
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_VERSION);
  });

  it('accepts a supported version and rejects one it does not implement', () => {
    expect(() => assertSupportsProtocolVersion(PROTOCOL_VERSION)).not.toThrow();
    expect(() => assertSupportsProtocolVersion('9.9.9')).toThrow();
  });

  it('rejects a version that is merely plausible', () => {
    // The case a copied list would fail: 0.2.0 looks like the successor of
    // 0.1.0, and a sync would bring it in silently. It has to be refused until
    // someone adds it deliberately.
    expect(SUPPORTED_PROTOCOL_VERSIONS).not.toContain('0.2.0');
    expect(() => assertSupportsProtocolVersion('0.2.0')).toThrow();
  });

  it('names the requested and the supported versions when it refuses', () => {
    // A failure a reader cannot act on is a failure that gets worked around.
    let message = '';
    try {
      assertSupportsProtocolVersion('0.2.0');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('0.2.0');
    expect(message).toContain(PROTOCOL_VERSION);
    expect(message).toContain(PROTOCOL_NAME);
    expect(message).toContain(SDK_VERSION);
  });

  it('declares a pre-release protocol version rather than a stable one', () => {
    // Not a SPEC-010 section 5 requirement, but the two are published together
    // and a supported-set entry without the status is how 0.1.0 gets read as
    // "stable". PROTOCOL_STATUS carries it; this pins the pairing.
    expect(PROTOCOL_VERSION.startsWith('0.')).toBe(true);
  });
});
