import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { legacyHostRedirect, legacyHosts, publicOrigin, publicOrigins } from './origins.js';
import { serveForFile, serveForTest } from './testServer.js';

describe('publicOrigins', () => {
  it('is exactly BETTER_AUTH_URL in production', () => {
    expect(publicOrigins({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://flowsketch.example.com' }))
      .toEqual(['https://flowsketch.example.com']);
  });

  it('strips a trailing slash so the origin compares equal to what a browser sends', () => {
    expect(publicOrigin({ BETTER_AUTH_URL: 'https://flowsketch.example.com/' })).toBe('https://flowsketch.example.com');
  });

  it('adds the dev server origins outside production, without duplicating one', () => {
    expect(publicOrigins({ NODE_ENV: 'test', BETTER_AUTH_URL: 'https://flowsketch.example.com' }))
      .toEqual(['https://flowsketch.example.com', 'http://localhost:5199', 'http://127.0.0.1:5199']);
    expect(publicOrigins({ NODE_ENV: 'test' }))
      .toEqual(['http://localhost:5199', 'http://127.0.0.1:5199']);
  });
});

describe('legacyHosts', () => {
  it('reads a comma-separated list, trimmed and lower-cased, ignoring blanks', () => {
    expect(legacyHosts({ LEGACY_HOSTS: ' Old.example.com, older.example.com ,, ' }))
      .toEqual(['old.example.com', 'older.example.com']);
    expect(legacyHosts({})).toEqual([]);
  });
});

const app = express();
app.use(legacyHostRedirect(['old.example.com'], 'https://new.example.com/'));
app.get('/{*splat}', (req, res) => {
  res.json({ host: req.hostname, url: req.originalUrl });
});
const server = await serveForFile(app);

describe('legacyHostRedirect', () => {
  it('301s a retired hostname to the public origin, keeping path and query', async () => {
    const res = await request(server).get('/d/abc?x=1').set('Host', 'old.example.com').expect(301);
    expect(res.headers.location).toBe('https://new.example.com/d/abc?x=1');
  });

  it('matches the hostname case-insensitively', async () => {
    await request(server).get('/').set('Host', 'Old.Example.com').expect(301);
  });

  it('leaves every other hostname alone', async () => {
    const res = await request(server).get('/d/abc').set('Host', 'new.example.com').expect(200);
    expect(res.body).toEqual({ host: 'new.example.com', url: '/d/abc' });
  });

  it('is a no-op with an empty list', async () => {
    const bare = express();
    bare.use(legacyHostRedirect([], 'https://new.example.com'));
    bare.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    await request(await serveForTest(bare)).get('/').set('Host', 'old.example.com').expect(200);
  });
});
