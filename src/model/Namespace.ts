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

import { DeclKind, INamespaceDecl, IPropertyDecl, ITargetDecl, ITargetDefDecl } from "./AST";
import { NAME_COMPONENT_SEPARATOR, Name } from "./Name";

type ContentType = Namespace | ITargetDecl | IPropertyDecl;

export interface IPrefixMatch {
  /* The matched declaration */
  decl: ITargetDecl | IPropertyDecl;
  /* The part of the prefix string after the last ':' in the matched prefix (if any).
   * That is, if we match e.g. a/b:c/d at c, then `c` is the retained part
   */
  retainedPrefix: string;
  /* The part of the string that's left over after matching decl */
  rest: Name;
}

/**
 * A namespace is a target-like entity that contains other targets or properties.
 *
 */
export class Namespace {
  private content: Record<string, ContentType>;

  private targetDefs: Record<string, ITargetDefDecl>;

  /* If it's an explicit namespace, keep it here; leave undefined for implicit ones */
  private decl?: INamespaceDecl;

  constructor(content: Record<string, ContentType>, targetDefs: Record<string, ITargetDefDecl>, decl?: INamespaceDecl) {
    this.content = content;
    this.decl = decl;
    this.targetDefs = targetDefs;
  }

  /**
   * @return the property with the given name or undefined if there is no such property
   * (either the name does not exist or it is not a property)
   */
  public getProperty(name: string): IPropertyDecl | undefined {
    const item = this.getDecl(name);
    if (item?.kind === DeclKind.Property) {
      return item;
    }
  }

  /**
   * @return the target with the given name or undefined if there is no such target
   * (either the name does not exist or it is not a target)
   */
  public getTarget(name: string): ITargetDecl | undefined {
    const item = this.getDecl(name);
    if (item?.kind === DeclKind.Target) {
      return item;
    }
  }

  public getTargetDef(name: string): ITargetDefDecl | undefined {
    const parts = name.split(NAME_COMPONENT_SEPARATOR);
    const targetName = parts.pop()!; /* Array must contain at least 1 element */
    return this.getNamespacePrefix(parts)?.targetDefs[targetName];
  }

  /**
   * Given a Name, return the first target or prop that can be identified
   * as a prefix of the Name.
   * Note this requires the name to have a literal prefix.
   * @return the target or prop whose name forms a prefix of the
   */
  public getPrefixMatch(name: Name): IPrefixMatch | undefined {
    const literalPrefix = name.getLiteralPathPrefix();
    if (literalPrefix === "") {
      return undefined;
    }
    const parts = literalPrefix.split(/[:/]/);
    let node: Namespace = this;

    for (let idx = 0; idx < parts.length; idx++) {
      const next = node.content[parts[idx]];
      if (next instanceof Namespace) {
        node = next;
      } else {
        if (next?.kind === DeclKind.Target || next?.kind === DeclKind.Property) {
          const matchedLength = parts.slice(0, idx + 1).join(NAME_COMPONENT_SEPARATOR).length;
          const matchPrefix = literalPrefix.substring(0, matchedLength + 1);
          const rest = name.substring(matchedLength + 1);
          const colonIdx = matchPrefix.lastIndexOf(":");
          const retainedPrefix = colonIdx === -1 ? matchPrefix : matchPrefix.substring(colonIdx + 1);
          return { decl: next, retainedPrefix, rest };
        } else {
          return undefined;
        }
      }
    }
  }

  /**
   * @return the explicit (declared) namespace with the given name or undefined if there
   * is no such namespace (either the name does not exist or it is not a namespace)
   */
  public getNamespace(name: string): INamespaceDecl | undefined {
    const item = this.getDecl(name);
    if (item?.kind === DeclKind.Namespace) {
      return item;
    }
  }

  /**
   * @return the decl with the given name, or undefined if there is no such decl.
   * @param name
   * @returns
   */
  public getDecl(name: string): ITargetDecl | IPropertyDecl | INamespaceDecl | undefined {
    const parts = name.split(NAME_COMPONENT_SEPARATOR);
    const targetName = parts.pop()!; /* Array must contain at least 1 element */
    const item = this.getNamespacePrefix(parts)?.content[targetName];
    if (item instanceof Namespace) {
      return item.decl;
    } else {
      return item;
    }
  }

  private getNamespacePrefix(parts: string[]): Namespace | undefined {
    let ns: Namespace = this;
    for (let idx = 0; idx < parts.length; ++idx) {
      const next = ns.content[parts[idx]];
      if (!(next instanceof Namespace)) {
        return undefined;
      }
      ns = next;
    }
    return ns;
  }
}
