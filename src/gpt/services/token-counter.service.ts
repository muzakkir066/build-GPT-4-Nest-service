import { Injectable } from '@nestjs/common';
import { encodingForModel, getEncoding } from 'js-tiktoken';
import { ChatMessage } from '../interfaces/chat-message.interface';

@Injectable()
export class TokenCounterService {
  countMessages(messages: ChatMessage[], model: string): number {
    const encoder = this.resolveEncoder(model);
    const tokensPerMessage = 4;
    const tokensPerReplyPrimer = 2;

    return (
      messages.reduce((count, message) => {
        return (
          count +
          tokensPerMessage +
          encoder.encode(message.role).length +
          encoder.encode(message.content).length
        );
      }, 0) + tokensPerReplyPrimer
    );
  }

  countText(text: string, model: string): number {
    const encoder = this.resolveEncoder(model);
    return encoder.encode(text).length;
  }

  private resolveEncoder(model: string) {
    try {
      return encodingForModel(model as Parameters<typeof encodingForModel>[0]);
    } catch {
      return getEncoding('cl100k_base');
    }
  }
}