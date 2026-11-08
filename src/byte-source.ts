/** A ROM the DOS loader can read by range. Large packs stay on disk or in part cache. */

export interface ByteSource {
  readonly size: number;
  read(start: number, length: number): Promise<Uint8Array>;
  release?(): void;
}

export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    async read(start, length) {
      assertRange(bytes.byteLength, start, length);
      return bytes.slice(start, start + length);
    },
  };
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(start, length) {
      assertRange(blob.size, start, length);
      const data = await blob.slice(start, start + length).arrayBuffer();
      return new Uint8Array(data);
    },
  };
}

function assertRange(size: number, start: number, length: number): void {
  if (length === 0) return;
  if (start < 0 || length < 0 || start > size || length > size - start) {
    throw new Error('读取超出了文件范围。');
  }
}
