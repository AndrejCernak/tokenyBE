import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

import { json, raw } from 'body-parser';


async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3001'],
    credentials: true,
  });

  // Stripe webhook musí dostať RAW body (žiadny JSON parser)
app.use(json());
app.use('/stripe/webhook', raw({ type: 'application/json' })); // len webhook

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // console.log(`API on http://localhost:${port}`);
}
bootstrap();
