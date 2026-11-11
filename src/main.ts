import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ensureQueueExists } from './infrastructure/messaging/sqs.client';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  await ensureQueueExists();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Distributed Wagering Processor rodando na porta ${port}`);
}

bootstrap();