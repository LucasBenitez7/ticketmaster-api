import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from '../generated/prisma/client/client';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new CUSTOMER account. Returns an accessToken (15m) and a refreshToken (30d).',
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully.',
    schema: {
      example: { accessToken: 'eyJhbGci...', refreshToken: 'a3f9b2...' },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticates a user. Rate limited to 5 requests per minute per IP (anti brute-force). Returns an accessToken (15m) and a refreshToken (30d).',
  })
  @ApiResponse({
    status: 201,
    description: 'Login successful.',
    schema: {
      example: { accessToken: 'eyJhbGci...', refreshToken: 'a3f9b2...' },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchanges a valid refreshToken for a new accessToken and a new refreshToken. The previous refreshToken is invalidated immediately (rotation).',
  })
  @ApiResponse({
    status: 201,
    description: 'Tokens refreshed successfully.',
    schema: {
      example: { accessToken: 'eyJhbGci...', refreshToken: 'x7k2m1...' },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired, or already used refresh token',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout',
    description:
      'Invalidates the provided refreshToken immediately. The accessToken remains valid until its natural expiration (15m). Always returns 201 — even if the token was already invalid, to avoid leaking information.',
  })
  @ApiResponse({
    status: 201,
    description: 'Logged out successfully.',
    schema: { example: { message: 'Logged out successfully' } },
  })
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Patch('users/:id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change user role (ADMIN only)',
    description:
      'Promotes or demotes a user role. Cannot set the same role the user already has.',
  })
  @ApiParam({ name: 'id', description: 'Target user UUID' })
  @ApiResponse({
    status: 200,
    description: 'Role updated.',
    schema: {
      example: {
        id: 'uuid',
        email: 'user@example.com',
        name: 'John',
        role: 'ADMIN',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'User already has that role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN role required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.authService.changeRole(id, dto.role);
  }
}
