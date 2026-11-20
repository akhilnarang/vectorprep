/** zlib (PDF FlateDecode) via the platform's native CompressionStream / DecompressionStream. */

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export const deflate = (bytes: Uint8Array): Promise<Uint8Array> => pipe(bytes, new CompressionStream('deflate'));
export const inflate = (bytes: Uint8Array): Promise<Uint8Array> => pipe(bytes, new DecompressionStream('deflate'));
