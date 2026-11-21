import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { buildOpenApi } from './main';

process.env.SUPABASE_URL ??= 'https://raflrreyawwexjerfqpc.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'sb_publishable_HnSYucho5rhb57GQGXHc8A_jrrXAKDC';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'your-service-role-key';
process.env.SUPABASE_JWT_SECRET ??= 'openapi-export-secret-openapi-export';
process.env.CRON_SECRET ??= 'your-cron-secret';

async function exportSpec() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildOpenApi(app);
  const target = join(process.cwd(), 'openapi.json');
  writeFileSync(target, JSON.stringify(document, null, 2));
  await app.close();
  process.stdout.write(`wrote ${target}\n`);
}

void exportSpec();
