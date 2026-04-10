import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ResetConversationDto } from './dto/reset-conversation.dto';
import {
  ChatCompletionResult,
  GptService,
  ProviderComparisonResult,
  StreamChunk,
} from './gpt.service';
import { ChatMessage } from './interfaces/chat-message.interface';

@ApiTags('gpt')
@Controller('gpt')
export class GptController {
  constructor(private readonly gptService: GptService) {}

  @ApiOperation({ summary: 'Create a chat completion' })
  @ApiBody({ type: ChatRequestDto })
  @ApiOkResponse({
    description: 'Returns the assistant reply, token usage, and updated conversation history.',
  })
  @Post('chat')
  createChatCompletion(
    @Body() payload: ChatRequestDto,
  ): Promise<ChatCompletionResult | ProviderComparisonResult> {
    return this.gptService.createChatCompletion(payload);
  }

  @ApiOperation({ summary: 'Compare OpenAI and Anthropic responses side by side' })
  @ApiBody({ type: ChatRequestDto })
  @ApiOkResponse({
    description: 'Returns both provider responses so you can compare quality manually.',
  })
  @Post('chat/compare')
  compareChat(@Body() payload: ChatRequestDto): Promise<ProviderComparisonResult> {
    return this.gptService.compareProviders(payload);
  }

  @ApiOperation({ summary: 'Stream a chat completion over SSE' })
  @ApiBody({ type: ChatRequestDto })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'Streams start, delta, end, and error events as Server-Sent Events.',
  })
  @Post('chat/stream')
  async streamChatCompletion(
    @Body() payload: ChatRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    try {
      for await (const chunk of this.gptService.streamChatCompletion(payload)) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);

        if (chunk.type === 'error') {
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed.';
      const fallbackChunk: StreamChunk = {
        type: 'error',
        conversationId: payload.conversationId ?? 'new',
        provider: payload.provider === 'anthropic' ? 'anthropic' : 'openai',
        model: payload.model ?? 'default',
        error: message,
      };
      response.write(`data: ${JSON.stringify(fallbackChunk)}\n\n`);
    }

    response.end();
  }

  @ApiOperation({ summary: 'Get saved conversation history' })
  @ApiParam({
    name: 'conversationId',
    description: 'Conversation ID returned by the chat endpoints.',
  })
  @ApiOkResponse({
    description: 'Returns the in-memory history for the requested conversation.',
  })
  @Get('conversations/:conversationId')
  getConversation(
    @Param('conversationId') conversationId: string,
  ): { conversationId: string; history: ChatMessage[] } {
    return this.gptService.getConversation(conversationId);
  }

  @ApiOperation({ summary: 'Reset a saved conversation' })
  @ApiBody({ type: ResetConversationDto })
  @ApiOkResponse({
    description: 'Clears a saved conversation from the in-memory store.',
  })
  @Post('conversations/reset')
  resetConversation(@Body() payload: ResetConversationDto): {
    conversationId: string;
    cleared: boolean;
  } {
    return this.gptService.resetConversation(payload.conversationId);
  }
}