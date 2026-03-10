import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { EventStatus } from '../../generated/prisma/client/client';

export class UpdateEventStatusDto {
  @ApiProperty({
    enum: EventStatus,
    example: EventStatus.PUBLISHED,
    description: `New status for the event.
- DRAFT → initial state, not visible to customers
- PUBLISHED → visible and available for purchase
- SOLD_OUT → no tickets available
- CANCELLED → cancels all PAID orders automatically
- COMPLETED → event has finished`,
  })
  @IsEnum(EventStatus)
  status: EventStatus;
}
