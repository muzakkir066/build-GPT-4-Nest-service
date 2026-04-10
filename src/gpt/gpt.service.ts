import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  BadGatewayException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatMessage } from './interfaces/chat-message.interface';
import { ConversationStoreService } from './services/conversation-store.service';
import { TokenCounterService } from './services/token-counter.service';

type ProviderName = 'openai' | 'anthropic';
type RequestProvider = ProviderName | 'compare';

export interface ChatCompletionResult {
  conversationId: string;
  provider: ProviderName;
  model: string;
  reply: string;
  history: ChatMessage[];
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface ProviderComparisonResult {
  conversationId: string;
  prompt: string;
  model: {
    openai: string;
    anthropic: string;
  };
  openai: ChatCompletionResult;
  anthropic: ChatCompletionResult;
  note: string;
}

export interface StreamChunk {
  type: 'start' | 'delta' | 'end' | 'error';
  conversationId: string;
  provider: ProviderName;
  model: string;
  content?: string;
  error?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

@Injectable()
export class GptService {
  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic | null;
  private readonly defaultModel: string;
  private readonly defaultAnthropicModel: string;
  private readonly defaultProvider: RequestProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationStore: ConversationStoreService,
    private readonly tokenCounter: TokenCounterService,
  ) {
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!openAiKey) {
      throw new InternalServerErrorException('OPENAI_API_KEY is not configured.');
    }

    this.openai = new OpenAI({ apiKey: openAiKey });
    this.defaultModel = this.normalizeModelName(
      this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini',
    );
    this.defaultAnthropicModel = this.normalizeModelName(
      this.configService.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-20250514',
    );
    this.defaultProvider = this.resolveRequestProvider(
      this.configService.get<string>('DEFAULT_AI_PROVIDER') ?? 'openai',
    );

    const anthropicApiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null;
  }

  async createChatCompletion(
    payload: ChatRequestDto,
  ): Promise<ChatCompletionResult | ProviderComparisonResult> {
    const provider = this.resolveRequestProvider(payload.provider);

    if (provider === 'compare') {
      return this.compareProviders(payload);
    }

    return this.createProviderChatCompletion(provider, payload, payload.persistHistory ?? true);
  }

  async *streamChatCompletion(payload: ChatRequestDto): AsyncGenerator<StreamChunk> {
    const provider = this.resolveRequestProvider(payload.provider);

    if (provider === 'compare') {
      throw new ConflictException(
        'compare mode is not supported for streaming. Use POST /gpt/chat/compare.',
      );
    }

    yield* this.streamProviderChatCompletion(provider, payload, payload.persistHistory ?? true);
  }

  async compareProviders(payload: ChatRequestDto): Promise<ProviderComparisonResult> {
    const conversationId = this.conversationStore.ensureConversation(payload.conversationId);
    const comparisonPayload: ChatRequestDto = {
      ...payload,
      persistHistory: false,
    };

    const [openai, anthropic] = await Promise.all([
      this.createProviderChatCompletion('openai', comparisonPayload, false),
      this.createProviderChatCompletion('anthropic', comparisonPayload, false),
    ]);

    return {
      conversationId,
      prompt: payload.message,
      model: {
        openai: openai.model,
        anthropic: anthropic.model,
      },
      openai,
      anthropic,
      note:
        'This endpoint returns both provider outputs side by side so you can compare style, accuracy, formatting, and tone manually.',
    };
  }

  getConversation(conversationId: string): { conversationId: string; history: ChatMessage[] } {
    return {
      conversationId,
      history: this.conversationStore.getConversation(conversationId),
    };
  }

  resetConversation(conversationId: string): { conversationId: string; cleared: boolean } {
    return {
      conversationId,
      cleared: this.conversationStore.resetConversation(conversationId),
    };
  }

  private async createProviderChatCompletion(
    provider: ProviderName,
    payload: ChatRequestDto,
    persistHistory: boolean,
  ): Promise<ChatCompletionResult> {
    const conversationId = this.conversationStore.ensureConversation(payload.conversationId);
    const history = this.resolveHistory(conversationId, persistHistory);
    const messages = this.buildConversationMessages(history, payload);
    const model = this.resolveModel(provider, payload.model);
    const promptTokens = this.tokenCounter.countMessages(messages, model);

    if (provider === 'openai') {
      try {
        const response = await this.openai.chat.completions.create({
          model,
          messages: this.toOpenAiMessages(messages),
          temperature: payload.temperature,
          max_tokens: payload.maxTokens,
        });

        const reply = response.choices[0]?.message?.content?.trim() ?? '';
        const completionTokens =
          response.usage?.completion_tokens ?? this.tokenCounter.countText(reply, model);
        const totalTokens = response.usage?.total_tokens ?? promptTokens + completionTokens;

        const updatedHistory: ChatMessage[] = [
          ...history,
          { role: 'user', content: payload.message },
          { role: 'assistant', content: reply },
        ];

        if (persistHistory) {
          this.conversationStore.saveConversation(conversationId, updatedHistory);
        }

        return {
          conversationId,
          provider,
          model,
          reply,
          history: this.composeReturnedHistory(updatedHistory, payload.systemPrompt),
          tokens: {
            prompt: response.usage?.prompt_tokens ?? promptTokens,
            completion: completionTokens,
            total: totalTokens,
          },
        };
      } catch (error) {
        this.throwFriendlyOpenAiError(error, model);
      }
    }

    const anthropic = this.requireAnthropicClient();

    try {
      const response: any = await anthropic.messages.create({
        model,
        max_tokens: payload.maxTokens ?? 1024,
        messages: this.toAnthropicMessages(messages),
        system: payload.systemPrompt,
        temperature: payload.temperature,
      });

      const reply = this.extractAnthropicText(response.content ?? []);
      const completionTokens =
        response.usage?.output_tokens ?? this.tokenCounter.countText(reply, model);
      const promptTokensUsed = response.usage?.input_tokens ?? promptTokens;
      const totalTokens = promptTokensUsed + completionTokens;

      const updatedHistory: ChatMessage[] = [
        ...history,
        { role: 'user', content: payload.message },
        { role: 'assistant', content: reply },
      ];

      if (persistHistory) {
        this.conversationStore.saveConversation(conversationId, updatedHistory);
      }

      return {
        conversationId,
        provider,
        model,
        reply,
        history: this.composeReturnedHistory(updatedHistory, payload.systemPrompt),
        tokens: {
          prompt: promptTokensUsed,
          completion: completionTokens,
          total: totalTokens,
        },
      };
    } catch (error) {
      this.throwFriendlyAnthropicError(error, model);
    }
  }

  private async *streamProviderChatCompletion(
    provider: ProviderName,
    payload: ChatRequestDto,
    persistHistory: boolean,
  ): AsyncGenerator<StreamChunk> {
    const conversationId = this.conversationStore.ensureConversation(payload.conversationId);
    const history = this.resolveHistory(conversationId, persistHistory);
    const messages = this.buildConversationMessages(history, payload);
    const model = this.resolveModel(provider, payload.model);
    const promptTokens = this.tokenCounter.countMessages(messages, model);

    yield {
      type: 'start',
      conversationId,
      provider,
      model,
      tokens: {
        prompt: promptTokens,
        completion: 0,
        total: promptTokens,
      },
    };

    try {
      if (provider === 'openai') {
        const stream = await this.openai.chat.completions.create({
          model,
          messages: this.toOpenAiMessages(messages),
          temperature: payload.temperature,
          max_tokens: payload.maxTokens,
          stream: true,
        });

        let accumulatedReply = '';

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content ?? '';

          if (!content) {
            continue;
          }

          accumulatedReply += content;

          yield {
            type: 'delta',
            conversationId,
            provider,
            model,
            content,
          };
        }

        const completionTokens = this.tokenCounter.countText(accumulatedReply, model);
        const totalTokens = promptTokens + completionTokens;
        const updatedHistory: ChatMessage[] = [
          ...history,
          { role: 'user', content: payload.message },
          { role: 'assistant', content: accumulatedReply },
        ];

        if (persistHistory) {
          this.conversationStore.saveConversation(conversationId, updatedHistory);
        }

        yield {
          type: 'end',
          conversationId,
          provider,
          model,
          content: accumulatedReply,
          tokens: {
            prompt: promptTokens,
            completion: completionTokens,
            total: totalTokens,
          },
        };
        return;
      }

      const anthropic = this.requireAnthropicClient();
      const stream: any = await anthropic.messages.create({
        model,
        max_tokens: payload.maxTokens ?? 1024,
        messages: this.toAnthropicMessages(messages),
        system: payload.systemPrompt,
        stream: true,
        temperature: payload.temperature,
      });

      let accumulatedReply = '';

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          accumulatedReply += event.delta.text;

          yield {
            type: 'delta',
            conversationId,
            provider,
            model,
            content: event.delta.text,
          };
        }
      }

      const completionTokens = this.tokenCounter.countText(accumulatedReply, model);
      const totalTokens = promptTokens + completionTokens;
      const updatedHistory: ChatMessage[] = [
        ...history,
        { role: 'user', content: payload.message },
        { role: 'assistant', content: accumulatedReply },
      ];

      if (persistHistory) {
        this.conversationStore.saveConversation(conversationId, updatedHistory);
      }

      yield {
        type: 'end',
        conversationId,
        provider,
        model,
        content: accumulatedReply,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens,
        },
      };
    } catch (error) {
      yield {
        type: 'error',
        conversationId,
        provider,
        model,
        error: this.getFriendlyErrorMessage(error, model),
      };
    }
  }

  private requireAnthropicClient(): Anthropic {
    if (!this.anthropic) {
      throw new InternalServerErrorException('ANTHROPIC_API_KEY is not configured.');
    }

    return this.anthropic;
  }

  private extractAnthropicText(content: Array<{ type: string; text?: string }>): string {
    return content
      .map((block) => (block.type === 'text' ? block.text ?? '' : ''))
      .join('')
      .trim();
  }

  private buildConversationMessages(history: ChatMessage[], payload: ChatRequestDto): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (payload.systemPrompt) {
      messages.push({ role: 'system', content: payload.systemPrompt });
    }

    messages.push(...history);
    messages.push({ role: 'user', content: payload.message });

    return messages;
  }

  private composeReturnedHistory(history: ChatMessage[], systemPrompt?: string): ChatMessage[] {
    if (!systemPrompt) {
      return history;
    }

    return [{ role: 'system', content: systemPrompt }, ...history];
  }

  private resolveHistory(conversationId: string, persistHistory = true): ChatMessage[] {
    if (!persistHistory) {
      return [];
    }

    return this.conversationStore.getConversation(conversationId);
  }

  private resolveRequestProvider(provider?: string): RequestProvider {
    if (!provider) {
      return this.defaultProvider;
    }

    if (provider === 'openai' || provider === 'anthropic' || provider === 'compare') {
      return provider;
    }

    return this.defaultProvider;
  }

  private resolveModel(provider: ProviderName, requestedModel?: string): string {
    const fallback = provider === 'openai' ? this.defaultModel : this.defaultAnthropicModel;
    return this.normalizeModelName(requestedModel ?? fallback);
  }

  private normalizeModelName(model: string): string {
    return model.trim().toLowerCase();
  }

  private throwFriendlyOpenAiError(error: unknown, model: string): never {
    const status = this.getErrorStatus(error);
    const message = this.getFriendlyErrorMessage(error, model);

    switch (status) {
      case 400:
        throw new BadRequestException(message);
      case 401:
        throw new UnauthorizedException(message);
      case 403:
        throw new ForbiddenException(message);
      case 404:
        throw new BadRequestException(message);
      case 429:
        throw new BadGatewayException(message);
      default:
        throw new InternalServerErrorException(message);
    }
  }

  private throwFriendlyAnthropicError(error: unknown, model: string): never {
    const status = this.getErrorStatus(error);
    const message = this.getFriendlyErrorMessage(error, model);

    switch (status) {
      case 400:
        throw new BadRequestException(message);
      case 401:
        throw new UnauthorizedException(message);
      case 403:
        throw new ForbiddenException(message);
      case 404:
        throw new BadRequestException(
          `The Anthropic model "${model}" is unavailable or you do not have access to it. Set ANTHROPIC_MODEL to a valid Claude model ID.`,
        );
      case 429:
        throw new BadGatewayException(message);
      default:
        throw new InternalServerErrorException(message);
    }
  }

  private getFriendlyErrorMessage(error: unknown, model: string): string {
    const status = this.getErrorStatus(error);
    const rawMessage = this.getErrorMessage(error);

    if (status === 429) {
      return rawMessage;
    }

    if (status === 404) {
      return `The model "${model}" is unavailable or you do not have access to it. Set the matching model env var to a valid model ID.`;
    }

    return rawMessage;
  }

  private getErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'AI request failed.';
  }

  private toAnthropicMessages(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }));
  }

  private toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }
}
