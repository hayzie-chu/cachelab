# CacheLab

CacheLab is a semantic cache toolkit for TypeScript. It gives you a small client, pluggable storage adapters, embedding adapters, and a simple replay/evaluation path.

## Quick start

```ts
import { CacheLabClient, createInMemoryDatabaseAdapter } from "cachelab";

const client = new CacheLabClient({
	dbAdapter: createInMemoryDatabaseAdapter(),
	embeddingAdapter: {
		async embed(input) {
			return [input.length, 0, 0];
		},
	},
	llmAdapter: {
		async generate(prompt) {
			return `Answer: ${prompt}`;
		},
	},
});

const result = await client.query("How do I cache API responses?");
```

## Scripts

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run typecheck`
