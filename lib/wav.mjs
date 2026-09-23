// 16-bit PCM WAV encoder (works in Node and the browser).

export function encodeWav(L, R, sampleRate = 44100) {
  const n = L.length, bytes = 44 + n * 4;
  const buf = new ArrayBuffer(bytes), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    o += 4;
  }
  return new Uint8Array(buf);
}
