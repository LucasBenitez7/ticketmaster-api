import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    // Config global — disponible en toda la app sin importar en cada módulo
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Logger estructurado global
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
          },
        },
      },
    }),
  ],
})
export class AppModule {}
