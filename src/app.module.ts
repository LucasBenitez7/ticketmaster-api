import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: isDev ? 'debug' : 'info',
        transport: isDev
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
              },
            }
          : undefined,
      },
    }),
    PrismaModule,
    AuthModule,
  ],
})
export class AppModule {}
