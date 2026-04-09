import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ResetConversationDto {
  @ApiProperty({
    description: 'Conversation ID to clear from the in-memory store.',
    example: '9b5d6c9e-58dc-4d25-bc77-1e6d1d0f8ddf',
  })
  @IsString()
  conversationId!: string;
}