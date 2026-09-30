import { DefaultAzureCredential } from '@azure/identity';
import { TableClient } from '@azure/data-tables';
import { StorageUnavailableError } from './port.js';

const PARTITION = 'handoff';
const MAX_ATTEMPTS = 5;

/** Build the deployed adapter; DefaultAzureCredential resolves the App Service managed identity. */
export function createTableStore({ url, tableName }) {
  return new TableHandoffStore(new TableClient(url, tableName, new DefaultAzureCredential()));
}

function toEntity(handoff) {
  const { acknowledgedAt, ...rest } = handoff;
  return { partitionKey: PARTITION, rowKey: handoff.id, ...rest, ...(acknowledgedAt ? { acknowledgedAt } : {}) };
}

function toHandoff(entity) {
  return {
    id: entity.rowKey,
    service: entity.service,
    summary: entity.summary,
    nextAction: entity.nextAction,
    state: entity.state,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    acknowledgedAt: entity.acknowledgedAt ?? null,
  };
}

const isStatus = (error, status) => error?.statusCode === status;

/** Azure Table adapter over any client with the TableClient surface used here. */
export class TableHandoffStore {
  #client;

  constructor(client) {
    this.#client = client;
  }

  async create(handoff) {
    await this.#guard(() => this.#client.createEntity(toEntity(handoff)));
    return { ...handoff };
  }

  async get(id) {
    const entity = await this.#fetch(id);
    return entity ? toHandoff(entity) : null;
  }

  async list() {
    return this.#guard(async () => {
      const handoffs = [];
      for await (const entity of this.#client.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } })) {
        handoffs.push(toHandoff(entity));
      }
      return handoffs;
    });
  }

  async update(id, mutator) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const entity = await this.#fetch(id);
      if (!entity) {
        return null;
      }
      const next = mutator(toHandoff(entity));
      try {
        await this.#client.updateEntity(toEntity(next), 'Replace', { etag: entity.etag });
        return { ...next };
      } catch (error) {
        if (!isStatus(error, 412)) {
          throw new StorageUnavailableError('Table storage is unavailable.', { cause: error });
        }
      }
    }
    throw new StorageUnavailableError('Table storage update conflicted repeatedly.');
  }

  async ping() {
    await this.#guard(async () => {
      await this.#client.listEntities({ queryOptions: { top: 1 } })[Symbol.asyncIterator]().next();
    });
  }

  async #fetch(id) {
    try {
      return await this.#client.getEntity(PARTITION, id);
    } catch (error) {
      if (isStatus(error, 404)) {
        return null;
      }
      throw new StorageUnavailableError('Table storage is unavailable.', { cause: error });
    }
  }

  async #guard(task) {
    try {
      return await task();
    } catch (error) {
      throw error instanceof StorageUnavailableError
        ? error
        : new StorageUnavailableError('Table storage is unavailable.', { cause: error });
    }
  }
}

