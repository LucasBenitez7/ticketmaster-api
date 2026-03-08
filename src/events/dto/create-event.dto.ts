import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString, MinLength } from 'class-validator';

export class CreateEventDto {
  @ApiProperty({ example: 'Rock Festival 2026' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty({ example: 'The best rock festival of the year in the city' })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiProperty({ example: '2026-08-15T20:00:00.000Z' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: 'Madison Square Garden, New York' })
  @IsString()
  location: string;
}
