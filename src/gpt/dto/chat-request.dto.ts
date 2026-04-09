import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({
    description: 'The user message sent to the model.',
    example: 'Explain NestJS providers in simple terms.',
  })
  @IsString()
  message!: string;

  @ApiPropertyOptional({
    description: 'Existing conversation ID to continue a stored chat history.',
    example: '9b5d6c9e-58dc-4d25-bc77-1e6d1d0f8ddf',
  })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({
    description: 'Optional system instruction added before the user message.',
    example: 'You are a concise backend mentor.',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description: 'OpenAI model name.',
    example: 'gpt-4',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: 'Sampling temperature between 0 and 2.',
    example: 0.7,
    minimum: 0,
    maximum: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of completion tokens to generate.',
    example: 300,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: 'When true, user and assistant messages are saved in the in-memory store.',
    example: true,
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  persistHistory?: boolean = true;
}