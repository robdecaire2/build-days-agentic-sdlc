import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StorageUnavailableError } from './port.js';

/** Durable local adapter: one JSON document, serialized and atomically replaced writes. */
export class FileHandoffStore {
  #file;
  #queue = Promise.resolve();

  constructor(file) {
    this.#file = file;
  }

  async create(handoff) {
    return this.#locked(async () => {
      const records = await this.#read();
      records[handoff.id] = handoff;
      await this.#write(records);
      return { ...handoff };
    });
  }

  async get(id) {
    const records = await this.#locked(() => this.#read());
    return records[id] ? { ...records[id] } : null;
  }

  async list() {
    const records = await this.#locked(() => this.#read());
    return Object.values(records).map((record) => ({ ...record }));
  }

  async update(id, mutator) {
    return this.#locked(async () => {
      const records = await this.#read();
      if (!records[id]) {
        return null;
      }
      const next = mutator({ ...records[id] });
      records[id] = next;
      await this.#write(records);
      return { ...next };
    });
  }

  async ping() {
    await this.#locked(async () => {
      await this.#read();
      await this.#write(await this.#read());
    });
  }

  #locked(task) {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => undefined);
    return run.catch((error) => {
      throw error instanceof StorageUnavailableError || !isFileSystemError(error)
        ? error
        : new StorageUnavailableError('File storage is unavailable.', { cause: error });
    });
  }

  async #read() {
    try {
      return JSON.parse(await readFile(this.#file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async #write(records) {
    await mkdir(path.dirname(this.#file), { recursive: true });
    const temporary = `${this.#file}.tmp`;
    await writeFile(temporary, JSON.stringify(records, null, 2), 'utf8');
    await rename(temporary, this.#file);
  }
}

function isFileSystemError(error) {
  return typeof error?.code === 'string' || error instanceof SyntaxError;
}
