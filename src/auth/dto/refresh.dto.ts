import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    example: 'a3f9b2c1d4e5...',
    description:
      'The refresh token received from login or register. Valid for 30 days. Each use invalidates the previous token (rotation).',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
