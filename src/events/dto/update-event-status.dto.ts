import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { EventStatus } from '../../generated/prisma/client/client';

export class UpdateEventStatusDto {
  @ApiProperty({ enum: EventStatus })
  @IsEnum(EventStatus)
  status: EventStatus;
}
