export type ConversationRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ConversationRole;
  content: string;
}
