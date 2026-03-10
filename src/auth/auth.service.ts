import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '../generated/prisma/client/client';

const REFRESH_TOKEN_EXPIRES_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const exists = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (exists) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: { name: dto.name, email: normalizedEmail, password: hashed },
    });

    const accessToken = this.signAccessToken(
      user.id,
      user.email,
      user.name,
      user.role,
    );
    const refreshToken = await this.generateRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.signAccessToken(
      user.id,
      user.email,
      user.name,
      user.role,
    );
    const refreshToken = await this.generateRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async refresh(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { id: stored.id },
    });

    if (count === 0) {
      throw new UnauthorizedException('Refresh token already used');
    }

    const { user } = stored;

    const accessToken = this.signAccessToken(
      user.id,
      user.email,
      user.name,
      user.role,
    );
    const refreshToken = await this.generateRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async logout(rawToken: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.refreshToken.deleteMany({
      where: { token: tokenHash },
    });

    return { message: 'Logged out successfully' };
  }

  async changeRole(targetUserId: string, newRole: Role) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) throw new NotFoundException('User not found');

    if (user.role === newRole) {
      throw new BadRequestException(`User already has role ${newRole}`);
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: { id: true, email: true, name: true, role: true },
    });

    return updated;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private signAccessToken(
    userId: string,
    email: string,
    name: string,
    role: Role,
  ): string {
    return this.jwt.sign({ sub: userId, email, name, role });
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

    // Limpiar tokens expirados del usuario antes de crear uno nuevo
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    await this.prisma.refreshToken.create({
      data: { token: tokenHash, userId, expiresAt },
    });

    return rawToken;
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
