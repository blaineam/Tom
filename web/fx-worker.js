// One channel of the mix's effects (echo + reverb), for worker.js's pool.
import { channelFx } from './lib/arrange.mjs';

self.onmessage = (e) => {
  const { jid, job } = e.data;
  try {
    const x = channelFx(job);
    self.postMessage({ jid, x }, [x.buffer]);
  } catch (err) {
    self.postMessage({ jid, error: String(err && err.message || err) });
  }
};
