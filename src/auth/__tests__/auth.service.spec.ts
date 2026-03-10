import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Role } from '../../generated/prisma/client/client';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockJwt = { sign: jest.fn().mockReturnValue('mock-access-token') };
const mockConfig = { get: jest.fn().mockReturnValue('15m') };

const mockUser = {
  id: 'user-uuid-1',
  name: 'John Doe',
  email: 'john@example.com',
  password: '$2b$10$hashedpassword',
  role: Role.CUSTOMER,
  createdAt: new Date(),
};

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 1000);

const mockStoredToken = {
  id: 'token-uuid-1',
  token: 'hashed-token',
  userId: mockUser.id,
  expiresAt: futureDate,
  user: mockUser,
};

// generateRefreshToken hace: deleteMany(cleanup) → create
const mockGenerateRefreshToken = () => {
  mockPrisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 0 });
  mockPrisma.refreshToken.create.mockResolvedValueOnce({});
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ─── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    const dto = {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'password123',
    };

    it('should register a new user and return accessToken + refreshToken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockGenerateRefreshToken();

      const result = await service.register(dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'john@example.com' },
      });
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBe('mock-access-token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);
    });

    it('should normalize email to lowercase', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockGenerateRefreshToken();

      await service.register({ ...dto, email: '  JOHN@EXAMPLE.COM  ' });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'john@example.com' },
      });
    });

    it('should hash the password before storing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockGenerateRefreshToken();

      await service.register(dto);

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.password).not.toBe(dto.password);
      expect(createCall.data.password).toMatch(/^\$2b\$/);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto = { email: 'john@example.com', password: 'password123' };

    it('should return tokens on valid credentials', async () => {
      const hashedPassword = await bcrypt.hash(dto.password, 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        password: hashedPassword,
      });
      mockGenerateRefreshToken();

      const result = await service.login(dto);

      expect(result.accessToken).toBe('mock-access-token');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser); // hash no coincide
      await expect(
        service.login({ ...dto, password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should use the same error message for both failures (prevent user enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      let err1: Error | undefined;
      try {
        await service.login(dto);
      } catch (e) {
        err1 = e as Error;
      }

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      let err2: Error | undefined;
      try {
        await service.login({ ...dto, password: 'wrongpassword' });
      } catch (e) {
        err2 = e as Error;
      }

      expect(err1?.message).toBe(err2?.message);
    });

    it('should not create a refresh token if credentials are invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login(dto)).rejects.toThrow();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  // ─── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('should return new tokens when refresh token is valid', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(mockStoredToken);
      // 1st call: rotación (deleteMany by id) → count 1
      // 2nd call: cleanup expirados dentro de generateRefreshToken → count 0
      mockPrisma.refreshToken.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh('valid-raw-token');

      expect(result.accessToken).toBe('mock-access-token');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should throw UnauthorizedException if token not found in DB', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('unknown-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should delete expired token and throw UnauthorizedException', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...mockStoredToken,
        expiresAt: pastDate,
      });
      mockPrisma.refreshToken.delete.mockResolvedValue({});

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: mockStoredToken.id },
      });
    });

    it('should throw UnauthorizedException on race condition (deleteMany count=0)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(mockStoredToken);
      // Token ya fue borrado por request concurrente
      mockPrisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.refresh('raced-token')).rejects.toThrow(
        new UnauthorizedException('Refresh token already used'),
      );
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should invalidate old token before issuing new one (rotation check)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(mockStoredToken);
      mockPrisma.refreshToken.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      await service.refresh('valid-raw-token');

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { id: mockStoredToken.id },
      });
    });
  });

  // ─── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should delete the refresh token by hash and return success message', async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.logout('valid-raw-token');

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
      expect(result.message).toBe('Logged out successfully');
    });

    it('should not throw if token does not exist (idempotent)', async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('nonexistent-token')).resolves.toEqual({
        message: 'Logged out successfully',
      });
    });
  });

  // ─── changeRole ────────────────────────────────────────────────────────────

  describe('changeRole', () => {
    it('should update role and return updated user without password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser); // role: CUSTOMER
      mockPrisma.user.update.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        role: Role.ADMIN,
      });

      const result = await service.changeRole(mockUser.id, Role.ADMIN);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { role: Role.ADMIN },
        select: { id: true, email: true, name: true, role: true },
      });
      expect(result.role).toBe(Role.ADMIN);
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changeRole('nonexistent-id', Role.ADMIN),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if user already has that role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        role: Role.ADMIN,
      });

      await expect(service.changeRole(mockUser.id, Role.ADMIN)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
