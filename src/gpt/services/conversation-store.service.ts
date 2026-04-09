import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatMessage } from '../interfaces/chat-message.interface';

@Injectable()
export class ConversationStoreService {
  private readonly store = new Map<string, ChatMessage[]>();

  createConversation(initialMessages: ChatMessage[] = []): string {
    const conversationId = randomUUID();
    this.store.set(conversationId, [...initialMessages]);
    return conversationId;
  }

  getConversation(conversationId: string): ChatMessage[] {
    return [...(this.store.get(conversationId) ?? [])];
  }

  saveConversation(conversationId: string, messages: ChatMessage[]): void {
    this.store.set(conversationId, [...messages]);
  }

  appendMessages(conversationId: string, ...messages: ChatMessage[]): void {
    const history = this.store.get(conversationId) ?? [];
    this.store.set(conversationId, [...history, ...messages]);
  }

  ensureConversation(conversationId?: string, initialMessages: ChatMessage[] = []): string {
    if (conversationId && this.store.has(conversationId)) {
      return conversationId;
    }

    return this.createConversation(initialMessages);
  }

  resetConversation(conversationId: string): boolean {
    return this.store.delete(conversationId);
  }
}
