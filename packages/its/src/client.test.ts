import { describe, expect, test, vi } from 'vitest';
import { createItsClient, ItsError } from './client.ts';

const fakeFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('live client', () => {
  test('throws ItsError without leaking the key on 4001', async () => {
    const c = createItsClient({ mode: 'live', apiKey: 'SECRETKEY', fetchImpl: fakeFetch({ header: { resultCode: 4001, resultMsg: '사용량 제한' } }) });
    await expect(c.events()).rejects.toMatchObject({ code: '4001' });
    await c.events().catch((e) => {
      expect(e).toBeInstanceOf(ItsError);
      expect(String(e.message) + String(e.stack)).not.toContain('SECRETKEY');
    });
  });

  test('http errors and network failures do not leak the key', async () => {
    const http = createItsClient({ mode: 'live', apiKey: 'SECRETKEY', fetchImpl: fakeFetch({}, 503) });
    await expect(http.events()).rejects.toMatchObject({ code: 'HTTP_503' });
    const net = createItsClient({
      mode: 'live', apiKey: 'SECRETKEY',
      fetchImpl: (async (u: string) => { throw new Error(`boom ${u}`); }) as unknown as typeof fetch,
    });
    const e = await net.events().catch((x) => x);
    expect(e.code).toBe('NETWORK');
    expect(String(e.message) + String(e.stack)).not.toContain('SECRETKEY');
  });

  test('builds the expected urls', async () => {
    const f = fakeFetch({ header: { resultCode: 0 }, body: { items: [] }, response: { data: [] } });
    const c = createItsClient({ mode: 'live', apiKey: 'K', fetchImpl: f });
    await c.events();
    await c.cctvs('its', { minX: 127, maxX: 127.2, minY: 37.3, maxY: 37.5 });
    await c.cctvs('ex');
    const urls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((x) => String(x[0]));
    expect(urls[0]).toBe('https://openapi.its.go.kr:9443/eventInfo?apiKey=K&type=all&eventType=all&getType=json');
    expect(urls[1]).toBe('https://openapi.its.go.kr:9443/cctvInfo?apiKey=K&type=its&cctvType=4&minX=127&maxX=127.2&minY=37.3&maxY=37.5&getType=json');
    expect(urls[2]).toContain('minX=124&maxX=132&minY=33&maxY=39');
  });

  test('requires a key', async () => {
    await expect(createItsClient({ mode: 'live', fetchImpl: fakeFetch({}) }).events()).rejects.toMatchObject({ code: 'NO_KEY' });
  });
});

describe('fixture client', () => {
  test('never calls fetch', async () => {
    const f = vi.fn();
    const c = createItsClient({ mode: 'fixture', fetchImpl: f });
    expect((await c.events()).length).toBe(284);
    expect((await c.cctvs('ex')).length).toBe(172);
    expect(f).not.toHaveBeenCalled();
  });
});
