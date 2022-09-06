export async function readStream(s: ReadableStream<Uint8Array | ArrayBuffer>) {
  let buf = new Uint8Array();
  const reader = s.getReader();
  while (true) {
    const {value: data, done} = await reader.read();
    if (done) {
      break;
    }
    buf = new Uint8Array([...buf, ...new Uint8Array(data)]);
  }
  return buf;
}
