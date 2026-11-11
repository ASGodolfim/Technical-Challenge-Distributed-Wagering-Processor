import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StructuredLogger } from './infrastructure/observability/structured-logger.service';

async function bootstrap() {
  const logger = new StructuredLogger();
  const app = await NestFactory.create(AppModule, { logger });
  app.useLogger(logger);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Wagering Processor listening on port ${port}`, 'Bootstrap');
}
bootstrap();