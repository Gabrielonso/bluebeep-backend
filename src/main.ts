import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { useContainer } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from 'src/common/filters/http-exception.filter';
import { AllExceptionsFilter } from 'src/common/filters/all-exception.filter';
import { ConfigureSwagger } from './config/swagger-config';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);

  // Socket.IO Redis adapter so websockets work across multiple instances.
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || configService.get<number>('PORT') || 4001;
  const env = configService.get<number>('NODE_ENV');
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new HttpExceptionFilter(configService),
    new AllExceptionsFilter(httpAdapterHost),
  );
  app.enableCors();
  app.setGlobalPrefix('v1');
  ConfigureSwagger(app);
  await app.listen(port);
  console.log(`Bluebeep ${env} is up and running on port: ${port}!`);
}
bootstrap();
