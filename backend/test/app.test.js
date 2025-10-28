import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';

async function request(path) {
  return new Promise((resolve, reject) => {
    const app = createApp({ port: 0 });
    const server = app.listen(() => {
      const { port } = server.address();
      http
        .request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            app.close(() => {
              resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
            });
          });
        })
        .on('error', (err) => {
          app.close(() => reject(err));
        })
        .end();
    });
  });
}

describe('createApp', () => {
  it('responds to health check', async () => {
    const response = await request('/healthz');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
  });

  it('returns 404 for unknown route', async () => {
    const response = await request('/unknown');
    assert.equal(response.statusCode, 404);
  });
});
