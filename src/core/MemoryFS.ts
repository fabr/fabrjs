/*
 * Copyright (c) 2022 Nathan Keynes <nkeynes@deadcoderemoval.net>
 *
 * This file is part of Fabr.
 *
 * Fabr is free software: you can redistribute it and/or modify it under the
 * terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * Fabr is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * Fabr. If not, see <https://www.gnu.org/licenses/>.
 */

import { Computable } from "./Computable";
import { hashString } from "./FSWrapper";
import { IFile, IFileStats } from "./FileSet";

export class MemoryFile implements IFile {
  private content: Buffer;
  private hash: string;
  stat: IFileStats;

  constructor(buffer: Buffer) {
    this.content = buffer;
    this.stat = {
      size: buffer.length,
      mtime: new Date(),
    };
    this.hash = hashString(buffer);
  }

  public static from(content: string, encoding: BufferEncoding = "utf8"): MemoryFile {
    return new MemoryFile(Buffer.from(content, encoding));
  }

  public getHash() : Computable<string> {
    return Computable.resolve(this.hash);
  }

  public readString(encoding: BufferEncoding = "utf8"): Computable<string> {
    return Computable.resolve(this.content.toString(encoding));
  }
  public getDisplayName(): string {
    throw new Error("Method not implemented.");
  }
  public isSameFile(file: IFile): boolean {
    return file instanceof MemoryFile && file.content === this.content;
  }
}
