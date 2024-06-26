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

import * as path from "path";

import { Computable } from "../core/Computable";
import { StringReader } from "../support/StringReader";
import { parseBuildFile } from "./Parser";
import { IBuildFileContents, IIncludeDecl } from "./AST";
import { Log } from "../support/Log";
import { BuildModel } from "./BuildModel";
import { toBuildModel } from "./Sema";
import { FileSource } from "../core/FileSet";
import { BuildCache } from "../core/BuildCache";

function resolveIncludes(baseFile: string, includes: IIncludeDecl[]): string[] {
  return includes.map(include => path.resolve(path.dirname(baseFile), include.filename));
}

type BuildFiles = Record<string, IBuildFileContents>;
const loadBuildCache: Record<string, Computable<BuildFiles>> = {};

/* FIXME: Detect cycles? */
function loadBuildFile(sourceTree: FileSource, file: string, log: Log): Computable<BuildFiles> {
  if (!(file in loadBuildCache)) {
    loadBuildCache[file] = sourceTree.get(file).then(f => {
      if (!f) {
        throw new Error("File not found: " + f);
      }
      return f.readString().then(content => {
        const source = { fs: sourceTree, file, reader: new StringReader(content) };
        const decls = parseBuildFile(source, log);
        const includes = resolveIncludes(file, decls.includes);
        if (includes.length > 0) {
          return Computable.forAll(
            includes.map(child => loadBuildFile(sourceTree, child, log)),
            (...children) => {
              const result: BuildFiles = { [file]: decls };
              children.forEach(decls => {
                Object.assign(result, decls);
              });
              return result;
            }
          );
        } else {
          return { [file]: decls };
        }
      });
    });
  }
  return loadBuildCache[file];
}

export function loadProject(fileSource: FileSource, startFile: string, buildCache: BuildCache, log: Log): Computable<BuildModel> {
  return loadBuildFile(fileSource, startFile, log).then(decls => toBuildModel(Object.values(decls), buildCache, log));
}
