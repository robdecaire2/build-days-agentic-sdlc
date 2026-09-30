/**
 * Storage port owned by the application. Adapters implement it; the API
 * depends only on this shape and never on an SDK.
 *
 * @typedef {object} Handoff
 * @property {string} id
 * @property {string} service
 * @property {string} summary
 * @property {string} nextAction
 * @property {'open'|'acknowledged'} state
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} acknowledgedAt
 *
 * @typedef {object} HandoffStore
 * @property {(handoff: Handoff) => Promise<Handoff>} create
 *   Persist a new handoff and return it.
 * @property {(id: string) => Promise<Handoff|null>} get
 *   Return the handoff or null when the id is unknown.
 * @property {() => Promise<Handoff[]>} list
 *   Return every handoff in any order (ordering is a contract concern).
 * @property {(id: string, mutator: (current: Handoff) => Handoff) => Promise<Handoff|null>} update
 *   Atomically apply mutator to the current record and persist the result.
 *   Return null (and change nothing) when the id is unknown. Errors thrown
 *   by mutator propagate and leave the record unchanged.
 * @property {() => Promise<void>} ping
 *   Resolve when the backing store is usable; reject otherwise.
 */

export class StorageUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}
