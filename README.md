# CacheLab

CacheLab is a semantic cache toolkit for TypeScript. It gives you a small client, pluggable storage adapters, embedding adapters, and a simple replay/evaluation path.

## Quick start

```ts
import { CacheLabClient, createInMemoryDatabaseAdapter } from "cachelab";

// Any object implementing the EmbeddingAdapter contract works here.
// (A built-in OpenAI adapter ships with the package — see "Embeddings" below.)
const embeddingAdapter = {
	async embed(input) {
		return toVector(input);
	},
	async embedBatch(inputs) {
		return inputs.map(toVector);
	},
};

const client = new CacheLabClient({
	dbAdapter: createInMemoryDatabaseAdapter(),
	embeddingAdapter,
});

const result = await client.invoke({
	query: "How do I cache API responses?",
	compute: async () => callYourModelOrApi(),
});
```

`invoke` embeds the query, looks for a semantically similar cached entry, and
either returns the cached value or runs `compute` and stores its result.

## Embeddings

An embedding adapter implements two methods:

- `embed(input)` — embed a single string.
- `embedBatch(inputs)` — embed many strings in one request, returning one
  vector per input in the same order.

A built-in OpenAI adapter is included (more providers are planned):

```ts
import { createOpenAIEmbeddingAdapter } from "cachelab";

const embeddingAdapter = createOpenAIEmbeddingAdapter({
	apiKey: process.env.OPENAI_API_KEY!,
});
```

### Seeding the cache

Use `seed` to load an initial set of saved query/value pairs. Queries are
embedded in **batched** requests by default; pass `{ batch: false }` to embed
them one-by-one.

```ts
await client.seed([
	{ query: "What are your hours?", value: "9am–5pm, Mon–Fri." },
	{ query: "Where are you located?", value: "123 Main St." },
]);

// Embed individually instead (e.g. to isolate a failing query):
await client.seed(savedQueries, { batch: false });
```

### Batching live queries

By default each `invoke` embeds its query immediately (lowest latency). To
coalesce concurrent end-user queries into shared embedding requests, pass a
`batching` config — a batch flushes when either `maxBatchSize` inputs are
buffered or `maxWaitMs` elapses, whichever comes first:

```ts
const client = new CacheLabClient({
	dbAdapter,
	embeddingAdapter,
	batching: { maxBatchSize: 16, maxWaitMs: 20 },
});
```

This trades a little latency (up to `maxWaitMs`) for fewer, larger requests.
Note that if a coalesced batch request fails, every query in that batch rejects
with the same error.

> **OpenAI input limit:** the OpenAI embeddings endpoint accepts at most **2048
> inputs per request**. The OpenAI adapter's `embedBatch` handles this for you —
> larger batches (e.g. big `seed` uploads) are transparently split into
> 2048-input chunks and stitched back together in order. This is independent of
> the `batching.maxBatchSize` coalescing setting above.

## Scripts

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run typecheck`
