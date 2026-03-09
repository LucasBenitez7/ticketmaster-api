import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '../generated/prisma/client/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

    const token = this.signToken(user.id, user.email, user.role);
    return { accessToken: token };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.signToken(user.id, user.email, user.role);
    return { accessToken: token };
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

  private signToken(userId: string, email: string, role: Role) {
    return this.jwt.sign({ sub: userId, email, role });
  }
}
