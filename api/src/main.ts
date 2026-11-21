import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

export function buildOpenApi(app: Parameters<typeof SwaggerModule.createDocument>[0]) {
  const config = new DocumentBuilder()
    .setTitle('Billflow API')
    .setDescription(
      'Multi-tenant billing API. Send the Supabase access token as a Bearer token. ' +
        'Row level security isolates tenants. JSON fields are snake_case.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer('http://127.0.0.1:4317', 'Local')
    .build();
  return SwaggerModule.createDocument(app, config);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',').map((value) => value.trim()) ?? true,
    allowedHeaders: ['authorization', 'content-type', 'x-cron-secret'],
  });
  const document = buildOpenApi(app);
  SwaggerModule.setup('docs', app, document);
  writeFileSync(join(process.cwd(), 'openapi.json'), JSON.stringify(document, null, 2));
  const port = Number(process.env.PORT ?? 4317);
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
