import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString, MinLength } from 'class-validator';

export class CreateEventDto {
  @ApiProperty({
    example: 'Rock Festival 2026',
    description: 'Event title (minimum 3 characters)',
    minLength: 3,
  })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiProperty({
    example: 'The best rock festival of the year featuring over 20 bands',
    description: 'Event description (minimum 10 characters)',
    minLength: 10,
  })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiProperty({
    example: '2026-08-15T20:00:00.000Z',
    description: 'Event date and time in ISO 8601 format',
  })
  @IsDateString()
  date: string;

  @ApiProperty({
    example: 'Madison Square Garden, New York',
    description: 'Event venue and city',
  })
  @IsString()
  location: string;
}
