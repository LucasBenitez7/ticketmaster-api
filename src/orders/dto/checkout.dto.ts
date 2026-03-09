import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max } from 'class-validator';

export class CheckoutDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the ticket category to purchase',
  })
  @IsUUID()
  categoryId: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 10,
    description:
      'Number of tickets to purchase (limited by maxTicketsPerUser on the category)',
  })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity: number;
}
