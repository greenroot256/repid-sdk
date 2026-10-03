// In-memory retained state.
//
// Isomorphic on purpose: nothing here imports from `node:`, so a browser can
// recognize facts and keep the required state for a session. Only persistence
// needs a filesystem, and that lives behind a separate entry point.
//
// The maps are the whole state. There is no cache and no derived index, because
// a derived value that can disagree with the thing it was derived from is a bug
// waiting to happen.

import type {
  IdentityRecord,
  Outpoint,
  RatingRightRecord,
  ReceiptRecord,
  RepidStateSnapshot,
  RepidStateStore,
  Txid,
} from '../types.js';

export function createMemoryStore(): RepidStateStore {
  const ratingRights = new Map<Outpoint, RatingRightRecord>();
  const receipts = new Map<Txid, ReceiptRecord>();
  const identities = new Map<Outpoint, IdentityRecord>();

  return {
    getRatingRight(outpoint) {
      return ratingRights.get(outpoint);
    },
    trackRatingRight(outpoint, info) {
      ratingRights.set(outpoint, { outpoint, ...info });
    },
    consumeRatingRight(outpoint) {
      ratingRights.delete(outpoint);
    },
    getReceipt(txid) {
      return receipts.get(txid);
    },
    trackReceipt(txid, record) {
      receipts.set(txid, record);
    },
    getIdentity(outpoint) {
      return identities.get(outpoint);
    },
    getIdentityByOwner(ownerPkh) {
      // A linear scan, and deliberately not a second map. An index would have to
      // be kept in step with `identities` by hand, and the bug it invites is
      // invisible: the store would report an identity it no longer tracks. The
      // number of live identities is small enough that scanning is cheaper than
      // that risk.
      for (const record of identities.values()) {
        if (record.ownerPkh === ownerPkh) return record;
      }
      return undefined;
    },
    trackIdentity(outpoint, record) {
      identities.set(outpoint, record);
    },
    untrackIdentity(outpoint) {
      identities.delete(outpoint);
    },
    snapshot() {
      return {
        ratingRights: [...ratingRights.entries()],
        receipts: [...receipts.entries()],
        identities: [...identities.entries()],
      };
    },
  };
}
