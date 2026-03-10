import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  Max,
  MinLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { RefundPolicy } from '../../generated/prisma/client/client';

export class CreateCategoryDto {
  @ApiProperty({ example: 'VIP' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({ example: 'Front row access and backstage pass' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 299.99 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalStock: number;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxTicketsPerUser?: number;

  @ApiPropertyOptional({ enum: RefundPolicy, default: RefundPolicy.REFUNDABLE })
  @IsOptional()
  @IsEnum(RefundPolicy)
  refundPolicy?: RefundPolicy;

  @ApiPropertyOptional({ example: 100, description: '0-100 percentage' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercentage?: number;

  @ApiPropertyOptional({ example: 48, description: 'Hours before event' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  refundDeadlineHours?: number;
}
