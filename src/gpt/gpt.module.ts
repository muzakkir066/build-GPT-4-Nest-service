import { Module } from '@nestjs/common';
import { GptController } from './gpt.controller';
import { GptService } from './gpt.service';
import { ConversationStoreService } from './services/conversation-store.service';
import { TokenCounterService } from './services/token-counter.service';

@Module({
  controllers: [GptController],
  providers: [GptService, ConversationStoreService, TokenCounterService],
})
export class GptModule {}
