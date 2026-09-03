const assert = require('node:assert');
const { collectWindows } = require('./push');

(async () => {
  const providers = [
    {
      name: 'Claude',
      fetch: async () => ({
        n: 'Claude',
        ok: true,
        bars: [{ l: '5h', p: 10, r: 0 }],
      }),
    },
    {
      name: 'Codex',
      fetch: () => {
        throw new Error('synthetic provider failure');
      },
    },
    {
      name: 'Cursor',
      fetch: async () => ({ n: 'Cursor', ok: true, bars: [] }),
    },
    {
      name: 'Grok',
      fetch: async () => ({
        n: 'Grok',
        ok: true,
        bars: [{ l: 'Credits', p: 42, r: 0 }],
      }),
    },
  ];

  const windows = await collectWindows(providers);
  assert.deepStrictEqual(windows, [
    {
      n: 'Claude',
      ok: true,
      bars: [{ l: '5h', p: 10, r: 0 }],
    },
    { n: 'Codex', ok: false, bars: [], e: 'err' },
    { n: 'Cursor', ok: true, bars: [] },
    {
      n: 'Grok',
      ok: true,
      bars: [{ l: 'Credits', p: 42, r: 0 }],
    },
  ]);

  console.log('push: provider rejection isolation passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
