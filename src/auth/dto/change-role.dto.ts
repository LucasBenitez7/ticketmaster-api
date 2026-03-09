import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Role } from '../../generated/prisma/client/client';

export class ChangeRoleDto {
  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;
}
