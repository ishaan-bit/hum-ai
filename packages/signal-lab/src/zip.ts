import { openSync, readSync, closeSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/**
 * Minimal, dependency-free ZIP reader (read-only, "zip-direct").
 *
 * The prepared public datasets (RAVDESS, VocalSet, VocalSound) ship their audio
 * inside .zip archives under the git-ignored `data/raw/`. The dataset manifests
 * explicitly note "read zip-direct" — i.e. read entries from the archive WITHOUT
 * extracting audio into the repo tree (extraction would create tracked-adjacent
 * .wav files and bloat disk). This reader does exactly that, using only Node
 * builtins (`fs`, `zlib`) per DEPENDENCY_POLICY.
 *
 * Scope: STORED (method 0) and DEFLATE (method 8) entries, 32-bit archives.
 * ZIP64 archives (>4 GB or >65535 entries) are detected and rejected with a clear
 * error so the caller can skip that dataset gracefully rather than mis-read it.
 *
 * Memory: the central directory is read eagerly (small); entry bodies are read
 * on demand via positioned `readSync`, so a 2 GB archive is never loaded whole.
 */

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CEN = 0x02014b50; // central directory file header
const SIG_LOC = 0x04034b50; // local file header
const ZIP64_MARK = 0xffffffff;

export class ZipError extends Error {
  constructor(message: string) {
    super(`ZIP read failed: ${message}`);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDirectory: boolean;
}

export class ZipArchive {
  private readonly fd: number;
  private readonly size: number;
  private readonly entryList: ZipEntry[];

  private constructor(fd: number, size: number, entries: ZipEntry[]) {
    this.fd = fd;
    this.size = size;
    this.entryList = entries;
  }

  static open(path: string): ZipArchive {
    const size = statSync(path).size;
    const fd = openSync(path, "r");
    try {
      const entries = ZipArchive.readCentralDirectory(fd, size);
      return new ZipArchive(fd, size, entries);
    } catch (err) {
      closeSync(fd);
      throw err;
    }
  }

  private static readAt(fd: number, position: number, length: number): Buffer {
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, position + read);
      if (n <= 0) break;
      read += n;
    }
    if (read < length) return buf.subarray(0, read);
    return buf;
  }

  private static readCentralDirectory(fd: number, size: number): ZipEntry[] {
    // EOCD is in the last 22 + comment(≤65535) bytes; scan backward for its sig.
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = ZipArchive.readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("end-of-central-directory record not found");

    const totalEntries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === ZIP64_MARK || cdSize === ZIP64_MARK || totalEntries === 0xffff) {
      throw new ZipError("ZIP64 archive not supported (read via an external tool)");
    }

    const cd = ZipArchive.readAt(fd, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < totalEntries; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CEN) {
        throw new ZipError(`malformed central directory at entry ${i}`);
      }
      const method = cd.readUInt16LE(p + 10);
      const compressedSize = cd.readUInt32LE(p + 20);
      const uncompressedSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      if (localHeaderOffset === ZIP64_MARK || compressedSize === ZIP64_MARK) {
        throw new ZipError("ZIP64 entry not supported");
      }
      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        isDirectory: name.endsWith("/"),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /** All entries (files and directory markers). */
  entries(): readonly ZipEntry[] {
    return this.entryList;
  }

  /** File entries (excludes directory markers). */
  files(): ZipEntry[] {
    return this.entryList.filter((e) => !e.isDirectory);
  }

  /** Read + decompress a single entry into a Buffer. */
  read(entry: ZipEntry): Buffer {
    // Parse the local header to find the real data start (its name/extra lengths
    // can differ from the central directory's, so read them here).
    const loc = ZipArchive.readAt(this.fd, entry.localHeaderOffset, 30);
    if (loc.length < 30 || loc.readUInt32LE(0) !== SIG_LOC) {
      throw new ZipError(`bad local header for ${entry.name}`);
    }
    const nameLen = loc.readUInt16LE(26);
    const extraLen = loc.readUInt16LE(28);
    const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const raw = ZipArchive.readAt(this.fd, dataStart, entry.compressedSize);
    if (entry.method === 0) return raw; // stored
    if (entry.method === 8) return inflateRawSync(raw); // deflate
    throw new ZipError(`unsupported compression method ${entry.method} for ${entry.name}`);
  }

  close(): void {
    closeSync(this.fd);
  }
}
