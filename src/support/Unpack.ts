import { Readable, Transform, Writable } from "stream";
import { pipeline } from "stream/promises";
import { createUnzip } from "zlib";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as tar from "tar-stream";
import { Computable } from "../core/Computable";
import { HASH_ALGORITHM } from "../core/FSWrapper";
import { FileSet, IFile } from "../core/FileSet";
import { FSFile } from "../core/FSFileSource";

export enum ArchiveType {
  AUTO,
  GZIP,
  ZIP,
  TAR,
  NONE,
}

const MIN_HEAD_LENGTH = 262; /* For TAR */

/**
 *
 * @param
 * @param targetdir
 */
export function unpackStream(ins: Readable, targetdir: string): Computable<FileSet> {
  return Computable.from((resolve, reject) => {
    let depth = 0;
    let fileMap = new Map<string, IFile>();
    function handleHeader(data: Buffer): Writable | null {
      switch (getMagic(data)) {
        case ArchiveType.GZIP:
          depth++;
          const zip = createUnzip();
          magicByteStream(zip, MIN_HEAD_LENGTH, handleHeader);
          return zip;
        case ArchiveType.TAR:
          const extract = tar.extract();
          extract.on("entry", (headers, entry, next) => {
            if (headers.type === "directory") {
              entry.on("end", () => {
                next();
              });
              entry.resume();
            } else {
              const hash = crypto.createHash(HASH_ALGORITHM);
              const pathname = path.resolve(targetdir, headers.name);
              const dir = path.dirname(pathname);
              fs.mkdirSync(dir, { recursive: true });
              const outfile = fs.createWriteStream(pathname);
              entry.on("end", () => {
                fileMap.set(
                  headers.name,
                  new FSFile(
                    targetdir,
                    headers.name,
                    { mtime: headers.mtime ?? new Date(), size: headers.size ?? 0 },
                    hash.digest("hex")
                  )
                );
                next();
              });
              const hashTransform = new Transform({
                transform: (chunk, _enc, cb) => {
                  hash.update(chunk);
                  cb(null, chunk);
                },
              });
              pipeline(entry, hashTransform, outfile);
            }
          });
          extract.on("finish", () => {
            resolve(new FileSet(fileMap));
          });
          return extract;
        default:
          reject(new Error("Unsupported archive file"));
          return null;
      }
    }

    magicByteStream(ins, MIN_HEAD_LENGTH, handleHeader);
  });
}

export function getMagic(buf: Buffer): ArchiveType {
  if (buf[0] === 0x1f && buf[1] === 0x8b && buf[2] === 0x08) {
    return ArchiveType.GZIP;
  } else if (buf[257] === 0x75 && buf[258] === 0x73 && buf[259] === 0x74 && buf[260] === 0x61 && buf[261] === 0x72) {
    return ArchiveType.TAR;
  } else if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return ArchiveType.ZIP;
  } else {
    return ArchiveType.NONE;
  }
}

function magicByteStream(ins: Readable, headerSize: number, cb: (data: Buffer) => Writable | null) {
  const buffers: Buffer[] = [];
  let bufferSize = 0;

  function headerEnd(): void {
    /* Input stream ended early. Well, try anway */
    invokeCallback();
  }

  function headerError(err: Error): void {
    /* Input stream failed */
  }

  function headerData(data: Buffer): void {
    buffers.push(data);
    bufferSize += data.length;
    if (bufferSize >= headerSize) {
      invokeCallback();
    }
  }

  function invokeCallback() {
    ins.removeListener("data", headerData);
    ins.removeListener("end", headerEnd);
    ins.removeListener("error", headerError);
    const head = Buffer.concat(buffers);
    const outs = cb(head);
    if (!outs) {
      ins.destroy();
    } else {
      outs.write(head);
      ins.pipe(outs);
    }
  }

  ins.on("data", headerData);
  ins.on("end", headerEnd);
  ins.on("error", headerError);
}
