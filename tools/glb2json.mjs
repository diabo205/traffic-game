// Convert a .glb into a self-contained glTF JSON (buffer embedded as a data URI).
import fs from 'node:fs';
const [src, dst] = process.argv.slice(2);
const b = fs.readFileSync(src);
if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a glb');
let off = 12, json = null, bin = null;
while (off < b.length) {
  const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
  const chunk = b.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
  else if (type === 0x004e4942) bin = chunk;
  off += 8 + len;
}
if (bin) json.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
fs.writeFileSync(dst, JSON.stringify(json));
console.log(dst, fs.statSync(dst).size);
