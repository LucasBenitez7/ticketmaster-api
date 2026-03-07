import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsDateString,
  IsNumber,
  IsPositive,
  MinLength,
  Min,
} from 'class-validator';

export class CreateEventDto {
  @ApiProperty({ example: 'Rock Festival 2026' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty({ example: 'The best rock festival of the year' })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiProperty({ example: '2026-08-15T20:00:00.000Z' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: 'Madison Square Garden, New York' })
  @IsString()
  location: string;

  @ApiProperty({ example: 99.99 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ example: 1000 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  totalTickets: number;
}
