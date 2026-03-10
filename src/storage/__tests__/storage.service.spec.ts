import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageService } from '../storage.service';

// ─── AWS SDK mock ─────────────────────────────────────────────────────────────

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input: Record<string, unknown>) => ({
      _type: 'PutObjectCommand',
      ...input,
    })),
  DeleteObjectCommand: jest
    .fn()
    .mockImplementation((input: Record<string, unknown>) => ({
      _type: 'DeleteObjectCommand',
      ...input,
    })),
}));

// ─── crypto mock ──────────────────────────────────────────────────────────────

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomUUID: jest.fn().mockReturnValue('mock-uuid-1234'),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockFile = {
  originalname: 'poster.jpg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from('fake-image-data'),
} as Express.Multer.File;

const mockFileWithoutExt = {
  originalname: 'poster',
  mimetype: 'image/jpeg',
  buffer: Buffer.from('fake-image-data'),
} as Express.Multer.File;

// ─── Config helpers ───────────────────────────────────────────────────────────

function buildConfig(overrides: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string> = {
    S3_ENDPOINT: '',
    S3_BUCKET_NAME: 'my-bucket',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'access-key',
    S3_SECRET_ACCESS_KEY: 'secret-key',
  };
  return {
    get: jest.fn((key: string) => overrides[key] ?? defaults[key] ?? undefined),
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function buildService(
    configOverrides: Record<string, string | undefined> = {},
  ) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: buildConfig(configOverrides) },
      ],
    }).compile();
    return module.get<StorageService>(StorageService);
  }

  // ─── uploadFile ────────────────────────────────────────────────────────────

  describe('uploadFile', () => {
    it('should upload file and return AWS S3 URL when no endpoint is set', async () => {
      service = await buildService({ S3_ENDPOINT: '' });
      mockS3Send.mockResolvedValue({});

      const url = await service.uploadFile(mockFile, 'events');

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(url).toBe(
        'https://my-bucket.s3.amazonaws.com/events/mock-uuid-1234.jpg',
      );
    });

    it('should upload file and return MinIO URL when endpoint is configured', async () => {
      service = await buildService({ S3_ENDPOINT: 'http://localhost:9000' });
      mockS3Send.mockResolvedValue({});

      const url = await service.uploadFile(mockFile, 'events');

      expect(url).toBe(
        'http://localhost:9000/my-bucket/events/mock-uuid-1234.jpg',
      );
    });

    it('should use correct PutObjectCommand params', async () => {
      service = await buildService({ S3_ENDPOINT: '' });
      mockS3Send.mockResolvedValue({});

      await service.uploadFile(mockFile, 'posters');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: 'posters/mock-uuid-1234.jpg',
        Body: mockFile.buffer,
        ContentType: mockFile.mimetype,
      });
    });

    it('should handle files without extension correctly', async () => {
      service = await buildService({ S3_ENDPOINT: '' });
      mockS3Send.mockResolvedValue({});

      const url = await service.uploadFile(mockFileWithoutExt, 'events');

      expect(url).toBe(
        'https://my-bucket.s3.amazonaws.com/events/mock-uuid-1234',
      );
    });

    it('should propagate S3 upload errors', async () => {
      service = await buildService();
      mockS3Send.mockRejectedValue(new Error('S3 upload failed'));

      await expect(service.uploadFile(mockFile, 'events')).rejects.toThrow(
        'S3 upload failed',
      );
    });
  });

  // ─── deleteFile ────────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    // extractKeyFromUrl splits by `/${bucket}/` in the path.
    // MinIO URLs and path-style S3 URLs contain /my-bucket/ in the path → works.
    // AWS virtual-hosted URLs have the bucket in the subdomain, not the path,
    // so the split finds nothing and the fallback returns the full URL as the key.

    it('should extract key correctly from MinIO URL', async () => {
      service = await buildService({ S3_ENDPOINT: 'http://localhost:9000' });
      mockS3Send.mockResolvedValue({});

      await service.deleteFile(
        'http://localhost:9000/my-bucket/events/poster.jpg',
      );

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: 'events/poster.jpg',
      });
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    it('should extract key correctly from path-style URL with /bucket/ in path', async () => {
      service = await buildService({ S3_ENDPOINT: '' });
      mockS3Send.mockResolvedValue({});

      await service.deleteFile(
        'https://s3.amazonaws.com/my-bucket/events/some-file.jpg',
      );

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: 'events/some-file.jpg',
      });
    });

    it('should fall back to full URL as key for virtual-hosted URLs (bucket in subdomain)', async () => {
      service = await buildService({ S3_ENDPOINT: '' });
      mockS3Send.mockResolvedValue({});

      // Virtual-hosted style: bucket is in the subdomain, not the path.
      // extractKeyFromUrl can't find /my-bucket/ → returns full URL as key.
      const virtualHostedUrl =
        'https://my-bucket.s3.amazonaws.com/events/file.jpg';

      await service.deleteFile(virtualHostedUrl);

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: virtualHostedUrl,
      });
    });

    it('should not throw if S3 deletion fails (error is caught and logged)', async () => {
      service = await buildService();
      mockS3Send.mockRejectedValue(new Error('S3 delete failed'));

      await expect(
        service.deleteFile('http://localhost:9000/my-bucket/events/file.jpg'),
      ).resolves.not.toThrow();
    });
  });
});
