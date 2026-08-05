import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: path.join(import.meta.dirname, '.env') });

export default defineConfig({
  earlyAccess: true,
  schema: path.join(import.meta.dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
