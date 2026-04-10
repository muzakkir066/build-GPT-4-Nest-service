# NestJS OpenAI + Claude Service

This project provides a NestJS API service that integrates with OpenAI GPT models and Anthropic Claude models, and includes:

- basic chat completions
- streaming responses over Server-Sent Events (SSE)
- per-request system prompts
- in-memory conversation history management
- token counting for prompts and completions
- Swagger UI for testing endpoints in the browser
- provider switching between OpenAI and Anthropic
- side-by-side response comparison

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file and add your API keys:

```bash
copy .env.example .env
```

3. Set your environment variables:

```env
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_MODEL=claude-sonnet-4-20250514
DEFAULT_AI_PROVIDER=openai
PORT=3000
```

4. Start the service:

```bash
npm run start:dev
```

## Swagger UI

Once the server is running, open:

- `http://localhost:3000/api`

Swagger UI lets you send requests to the API without Postman or curl. The `/gpt/chat`, `/gpt/chat/compare`, and `/gpt/conversations/reset` endpoints are directly testable from the page. The `/gpt/chat/stream` route is documented there as SSE, but many Swagger UIs do not render live stream chunks interactively, so it is best verified with an SSE-capable client.

## Providers

The `provider` field in the request body selects the backend:

- `openai` uses the OpenAI API
- `anthropic` uses the Claude API
- `compare` calls both providers and returns both responses side by side

If the field is omitted, the server falls back to `DEFAULT_AI_PROVIDER`.

Model names are normalized to lowercase before requests are sent. If either API returns a `404 model does not exist or you do not have access` error, the model ID is not available for your account. Update the request `model` field or the matching env var to a valid model name for that provider.

## Anthropic Key

You need to create your own Anthropic API key in the Anthropic console and set it in `ANTHROPIC_API_KEY`.

## Endpoints

### `POST /gpt/chat`

Standard chat completion request.

```json
{
  "message": "Explain NestJS providers in simple terms.",
  "systemPrompt": "You are a concise backend mentor.",
  "provider": "anthropic",
  "conversationId": "optional-existing-id",
  "temperature": 0.7,
  "maxTokens": 300,
  "persistHistory": true
}
```

Example response:

```json
{
  "conversationId": "9b5d6c9e-58dc-4d25-bc77-1e6d1d0f8ddf",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "reply": "Providers are classes that Nest can create and inject for you...",
  "history": [
    {
      "role": "system",
      "content": "You are a concise backend mentor."
    },
    {
      "role": "user",
      "content": "Explain NestJS providers in simple terms."
    },
    {
      "role": "assistant",
      "content": "Providers are classes that Nest can create and inject for you..."
    }
  ],
  "tokens": {
    "prompt": 29,
    "completion": 18,
    "total": 47
  }
}
```

### `POST /gpt/chat/compare`

Returns both OpenAI and Claude responses for the same prompt so you can compare output quality manually.

```json
{
  "message": "Summarize the tradeoffs of Redis vs PostgreSQL for caching.",
  "systemPrompt": "You are a practical backend architect.",
  "temperature": 0.3,
  "maxTokens": 400
}
```

Example response shape:

```json
{
  "conversationId": "conversation-id",
  "prompt": "Summarize the tradeoffs of Redis vs PostgreSQL for caching.",
  "model": {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-sonnet-4-20250514"
  },
  "openai": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "reply": "..."
  },
  "anthropic": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "reply": "..."
  },
  "note": "This endpoint returns both provider outputs side by side so you can compare style, accuracy, formatting, and tone manually."
}
```

### `POST /gpt/chat/stream`

Streams JSON SSE events. Each event is sent as `data: {...}`. Use `provider: "anthropic"` or `provider: "openai"`.

Stream event sequence:

- `start`: conversation id and prompt token estimate
- `delta`: incremental text chunks from the model
- `end`: final text plus token totals
- `error`: provider error message if the request fails

### `GET /gpt/conversations/:conversationId`

Returns the stored in-memory history for a conversation.

### `POST /gpt/conversations/reset`

Clears a conversation by id.

```json
{
  "conversationId": "9b5d6c9e-58dc-4d25-bc77-1e6d1d0f8ddf"
}
```

## Notes

- Conversation history is stored in memory, so it resets when the process restarts.
- For production, replace the in-memory store with Redis or a database.
- Token counts use `js-tiktoken`, with API usage values preferred when either provider returns them.
- After pulling these changes, run `npm install` so `@nestjs/swagger`, `swagger-ui-express`, and `@anthropic-ai/sdk` are available.
