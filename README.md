# NestJS GPT-4 Service

This project provides a NestJS API service that integrates with the OpenAI GPT API and includes:

- basic chat completions
- streaming responses over Server-Sent Events (SSE)
- per-request system prompts
- in-memory conversation history management
- token counting for prompts and completions
- Swagger UI for testing endpoints in the browser

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file and add your API key:

```bash
copy .env.example .env
```

3. Set your environment variables:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini"
PORT=3000
```

4. Start the service:

```bash
npm run start:dev
```

## Swagger UI

Once the server is running, open:

- `http://localhost:3000/api`

Swagger UI lets you send requests to the API without Postman or curl. The `/gpt/chat` and `/gpt/conversations/reset` endpoints are directly testable from the page. The `/gpt/chat/stream` route is documented there as SSE, but many Swagger UIs do not render live stream chunks interactively, so it is best verified with an SSE-capable client.

## Model Names

Model names are normalized to lowercase before requests are sent to OpenAI, so `GPT-5.4-Mini` becomes `gpt-5.4-mini`.

If OpenAI still returns a `404 model does not exist or you do not have access` error, the model ID is not available for your account. Update `OPENAI_MODEL` or the request `model` field to a valid model name from your OpenAI project.

## Endpoints

### `POST /gpt/chat`

Standard chat completion request.

```json
{
  "message": "Explain NestJS providers in simple terms.",
  "systemPrompt": "You are a concise backend mentor.",
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
  "model": "gpt-4o-mini",
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

### `POST /gpt/chat/stream`

Streams JSON SSE events. Each event is sent as `data: {...}`.

```json
{
  "message": "Write a short welcome note for new API users.",
  "systemPrompt": "You are a helpful product copywriter.",
  "persistHistory": true
}
```

Stream event sequence:

- `start`: conversation id and prompt token estimate
- `delta`: incremental text chunks from the model
- `end`: final text plus token totals

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
- Token counts use `js-tiktoken`, with API usage values preferred when OpenAI returns them.
- After pulling these changes, run `npm install` so `@nestjs/swagger` and `swagger-ui-express` are available.