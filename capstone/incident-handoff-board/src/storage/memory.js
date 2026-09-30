import { StorageUnavailableError } from './port.js';

/** Deterministic in-memory adapter for tests. Stores copies, never references. */
export class MemoryHandoffStore {
  #records = new Map();
  #available = true;

  async create(handoff) {
    this.#assertAvailable();
    this.#records.set(handoff.id, { ...handoff });
    return { ...handoff };
  }

  async get(id) {
    this.#assertAvailable();
    const record = this.#records.get(id);
    return record ? { ...record } : null;
  }

  async list() {
    this.#assertAvailable();
    return [...this.#records.values()].map((record) => ({ ...record }));
  }

  async update(id, mutator) {
    this.#assertAvailable();
    const current = this.#records.get(id);
    if (!current) {
      return null;
    }
    const next = mutator({ ...current });
    this.#records.set(id, { ...next });
    return { ...next };
  }

  async ping() {
    this.#assertAvailable();
  }

  /** Test hook: simulate the dependency going down or recovering. */
  setAvailable(available) {
    this.#available = available;
  }

  #assertAvailable() {
    if (!this.#available) {
      throw new StorageUnavailableError('In-memory store marked unavailable.');
    }
  }
}
