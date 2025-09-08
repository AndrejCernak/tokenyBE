import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded, raw } from 'express';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json());
  app.use(urlencoded({ extended: true }));
  app.use('/stripe/webhook', raw({ type: 'application/json' })); // Stripe potrebuje RAW
  const cfg = app.get(ConfigService);
  const port = Number(cfg.get('PORT') ?? 3000);
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);

  app.enableCors({
  origin: ['http://localhost:3001'],
  credentials: true,
});
}
bootstrap();


