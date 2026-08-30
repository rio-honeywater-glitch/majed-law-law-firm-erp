---
name: OpenAI embeddings need user key
description: Replit AI proxy does not support the embeddings API — RAG features need the user's own OPENAI_API_KEY
---
The Replit-managed OpenAI proxy (ai-integrations-openai) only supports chat completions, NOT `/embeddings`.

**Why:** Discovered while building the RAG legal assistant (July 2026) — embedding calls through the proxy fail, so `text-embedding-3-small` requires the user's own `OPENAI_API_KEY` secret (requested via requestEnvVar).

**How to apply:** Any feature needing embeddings (vector search, RAG) must use a raw `openai` client with `process.env.OPENAI_API_KEY` and degrade gracefully (Arabic 503 in this project) when the key is absent. Chat-only features can still use the proxy.
