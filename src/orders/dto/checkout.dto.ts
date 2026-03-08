import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min } from 'class-validator';

export class CheckoutDto {
  @ApiProperty({ example: 'uuid-de-la-categoria' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
