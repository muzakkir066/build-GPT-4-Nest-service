import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  TooManyRequestsException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatMessage } from './interfaces/chat-message.interface';
import { ConversationStoreService } from './services/conversation-store.service';
import { TokenCounterService } from './services/token-counter.service';

export interface ChatCompletionResult {
  conversationId: string;
  model: string;
  reply: string;
  history: ChatMessage[];
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface StreamChunk {
  type: 'start' | 'delta' | 'end' | 'error';
  conversationId: string;
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
  private readonly defaultModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationStore: ConversationStoreService,
    private readonly tokenCounter: TokenCounterService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      throw new InternalServerErrorException('OPENAI_API_KEY is not configured.');
    }

    this.openai = new OpenAI({ apiKey });
    this.defaultModel = this.normalizeModelName(
      this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini',
    );
  }

  async createChatCompletion(payload: ChatRequestDto): Promise<ChatCompletionResult> {
    const model = this.resolveRequestedModel(payload.model);
    const conversationId = this.conversationStore.ensureConversation(payload.conversationId);
    const history = this.resolveHistory(conversationId, payload.persistHistory);
    const messages = this.buildConversationMessages(history, payload);
    const promptTokens = this.tokenCounter.countMessages(messages, model);

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

      if (payload.persistHistory ?? true) {
        this.conversationStore.saveConversation(conversationId, updatedHistory);
      }

      return {
        conversationId,
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

  async *streamChatCompletion(payload: ChatRequestDto): AsyncGenerator<StreamChunk> {
    const model = this.resolveRequestedModel(payload.model);
    const conversationId = this.conversationStore.ensureConversation(payload.conversationId);
    const history = this.resolveHistory(conversationId, payload.persistHistory);
    const messages = this.buildConversationMessages(history, payload);
    const promptTokens = this.tokenCounter.countMessages(messages, model);

    yield {
      type: 'start',
      conversationId,
      model,
      tokens: {
        prompt: promptTokens,
        completion: 0,
        total: promptTokens,
      },
    };

    try {
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

      if (payload.persistHistory ?? true) {
        this.conversationStore.saveConversation(conversationId, updatedHistory);
      }

      yield {
        type: 'end',
        conversationId,
        model,
        content: accumulatedReply,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens,
        },
      };
    } catch (error) {
      const message = this.getFriendlyErrorMessage(error, model);
      yield {
        type: 'error',
        conversationId,
        model,
        error: message,
      };
    }
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

    const historyWithSystemPrompt: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];

    return historyWithSystemPrompt;
  }

  private resolveHistory(conversationId: string, persistHistory = true): ChatMessage[] {
    if (!persistHistory) {
      return [];
    }

    return this.conversationStore.getConversation(conversationId);
  }

  private resolveRequestedModel(requestedModel?: string): string {
    return this.normalizeModelName(requestedModel ?? this.defaultModel);
  }

  private normalizeModelName(model: string): string {
    return model.trim().toLowerCase();
  }

  private throwFriendlyOpenAiError(error: unknown, model: string): never {
    const message = this.getFriendlyErrorMessage(error, model);
    const status = this.getErrorStatus(error);

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
        throw new TooManyRequestsException(message);
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
      return `The model "${model}" is unavailable or you do not have access to it. Set OPENAI_MODEL to a valid OpenAI model ID.`;
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

    return 'OpenAI request failed.';
  }

  private toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }
}