import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Role } from '../../generated/prisma/client/client';

export class ChangeRoleDto {
  @ApiProperty({
    enum: Role,
    example: Role.ADMIN,
    description:
      'New role to assign to the user. Cannot be the same role the user already has.',
  })
  @IsEnum(Role)
  role: Role;
}
