import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full name of the user',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'john@example.com',
    description: 'Valid email address. Will be stored in lowercase.',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'MyPass123!',
    minLength: 6,
    description: 'Password with a minimum of 6 characters',
  })
  @IsString()
  @MinLength(6)
  password: string;
}
