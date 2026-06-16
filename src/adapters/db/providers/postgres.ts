import { Pool } from "pg";

import type { CacheDecision, CacheEntry } from "../../../types";
import type { DatabaseAdapter } from "../types";

export interface PostgresDatabaseAdapterOptions {
	connectionString: string;
	tableName?: string;
}

export function createPostgresDatabaseAdapter<TValue>(
	options: PostgresDatabaseAdapterOptions,
): DatabaseAdapter<TValue> {
	const pool = new Pool({
		connectionString: options.connectionString,
	});

	const tableName = options.tableName ?? "cache_entries";

	return {
		async initialize(): Promise<void> {
			await pool.query(`
				CREATE EXTENSION IF NOT EXISTS vector;
			`);

			await pool.query(`
				CREATE TABLE IF NOT EXISTS ${tableName} (
					id TEXT PRIMARY KEY,
					query TEXT NOT NULL,
					embedding VECTOR NOT NULL,
					value JSONB NOT NULL,
					created_at TIMESTAMPTZ NOT NULL,
					updated_at TIMESTAMPTZ NOT NULL,
					hits INTEGER NOT NULL DEFAULT 0,
					metadata JSONB
				);
			`);

			await pool.query(`
				CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx
				ON ${tableName}
				USING hnsw (embedding vector_cosine_ops);
			`);
		},

		async close(): Promise<void> {
			await pool.end();
		},

		async findBestMatch(
			queryEmbedding: ReadonlyArray<number>,
			threshold: number,
		): Promise<CacheDecision<TValue>> {
			const result = await pool.query(
				`
				SELECT *,
				       embedding <=> $1::vector AS distance
				FROM ${tableName}
				ORDER BY embedding <=> $1::vector
				LIMIT 1;
				`,
				[vectorLiteral(queryEmbedding)],
			);

			if (result.rows.length === 0) {
				return {
					hit: false,
					similarity: 0,
					threshold,
					entry: undefined,
					reason: "no-candidate",
				};
			}

			const row = result.rows[0];
			const similarity = 1 - Number(row.distance);

			if (similarity >= threshold) {
				return {
					hit: true,
					similarity,
					threshold,
					entry: rowToEntry<TValue>(row),
					reason: "threshold-met",
				};
			}

			return {
				hit: false,
				similarity,
				threshold,
				entry: undefined,
				reason: "threshold-not-met",
			};
		},

		async getAll(): Promise<Array<CacheEntry<TValue>>> {
			const result = await pool.query(`
				SELECT *
				FROM ${tableName};
			`);

			return result.rows.map((row) => rowToEntry<TValue>(row));
		},

		async getById(id: string): Promise<CacheEntry<TValue> | undefined> {
			const result = await pool.query(
				`
				SELECT *
				FROM ${tableName}
				WHERE id = $1;
				`,
				[id],
			);

			return result.rows.length > 0 ? rowToEntry<TValue>(result.rows[0]) : undefined;
		},

		async upsert(entry: CacheEntry<TValue>): Promise<void> {
			await pool.query(
				`
				INSERT INTO ${tableName}
				(
					id,
					query,
					embedding,
					value,
					created_at,
					updated_at,
					hits,
					metadata
				)
				VALUES
				(
					$1,
					$2,
					$3::vector,
					$4::jsonb,
					$5,
					$6,
					$7,
					$8::jsonb
				)
				ON CONFLICT (id)
				DO UPDATE SET
					query = EXCLUDED.query,
					embedding = EXCLUDED.embedding,
					value = EXCLUDED.value,
					updated_at = EXCLUDED.updated_at,
					hits = EXCLUDED.hits,
					metadata = EXCLUDED.metadata;
				`,
				[
					entry.id,
					entry.query,
					vectorLiteral(entry.embedding),
					JSON.stringify(entry.value),
					entry.createdAt,
					entry.updatedAt,
					entry.hits,
					entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
				],
			);
		},

		async remove(id: string): Promise<void> {
			await pool.query(
				`
				DELETE FROM ${tableName}
				WHERE id = $1;
				`,
				[id],
			);
		},

		async clear(): Promise<void> {
			await pool.query(`
				TRUNCATE TABLE ${tableName};
			`);
		},
	};
}

export type PostgresCacheEntry<TValue = unknown> = CacheEntry<TValue>;

function vectorLiteral(embedding: ReadonlyArray<number>): string {
	return `[${embedding.join(",")}]`;
}

function rowToEntry<TValue>(row: Record<string, unknown>): CacheEntry<TValue> {
	return {
		id: String(row.id),
		query: String(row.query),
		embedding: parseVector(String(row.embedding)),
		value: row.value as TValue,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
		hits: Number(row.hits),
		metadata: row.metadata === null ? undefined : (row.metadata as Record<string, unknown>),
	};
}

function parseVector(vector: string): Array<number> {
	return vector.slice(1, -1).split(",").map(Number);
}
