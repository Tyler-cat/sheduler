import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

function createAdapterFromUrl(url, poolConfig = {}) {
  if (!url) {
    throw new Error('DATABASE_URL is required to create a Prisma adapter');
  }
  const pool = new pg.Pool({ connectionString: url, ...poolConfig });
  return { adapter: new PrismaPg(pool), pool };
}

function createPrismaClient(options = {}) {
  if (options.adapter) {
    return new PrismaClient({ adapter: options.adapter, log: options.log });
  }
  const { adapter, pool } = createAdapterFromUrl(options.url ?? process.env.DATABASE_URL, options.poolConfig);
  const client = new PrismaClient({ adapter, log: options.log });
  if (!client.$pool) {
    Object.defineProperty(client, '$pool', {
      value: pool,
      enumerable: false
    });
  }
  return client;
}

async function disconnectPrisma(client) {
  if (!client) {
    return;
  }
  await client.$disconnect();
  if (client.$pool && typeof client.$pool.end === 'function') {
    await client.$pool.end();
  }
}

export { createPrismaClient, createAdapterFromUrl, disconnectPrisma };
