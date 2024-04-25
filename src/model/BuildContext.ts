import { BuildCache } from "../core/BuildCache";
import { Computable } from "../core/Computable";
import { FileSet, FileSource } from "../core/FileSet";
import { getTargetRule } from "../rules/Registry";
import { ResolvedTarget } from "../rules/Types";
import { DeclKind, IDecl, INamedDecl, INamespaceDecl, IPropertyDecl, ITargetDecl, ITargetDefDecl, IValue, PropertyType } from "./AST";
import { Name } from "./Name";
import { IPrefixMatch } from "./Namespace";
import { Property } from "./Property";
import { Target } from "./Target";

export type Constraints = Record<string, Property>;

interface IBuildModel {
  getConfig(constraints: Constraints): BuildContext;
  getDecl(name: string): IPropertyDecl | ITargetDecl | INamespaceDecl | undefined;
  getTargetDef(name: string): ITargetDefDecl | undefined;
  getPrefixMatch(name: Name): IPrefixMatch | undefined;
  getBuildCache(): BuildCache;
}

interface IDependencyStack {
  target?: ITargetDecl;
  property: IPropertyDecl;
  context: BuildContext;
  value: IValue;
  next?: IDependencyStack;
}

/**
 * A BuildContext is (effectively) the BuildModel instantiated with an explicit set of additional
 * constraints (which may be the empty set).
 *
 * As a practical matter, this is where everything is actually resolved and evaluated.
 */
export class BuildContext {
  protected constraints: Constraints;
  private model: IBuildModel;
  private propCache: Record<string, Computable<Property>>;
  private targetCache: Record<string, Computable<FileSource[]>>;

  constructor(model: IBuildModel, constraints: Constraints) {
    this.model = model;
    this.constraints = constraints;
    this.propCache = {};
    this.targetCache = {};
    // Pre-force the constraints so we don't have to check this later.
    Object.keys(constraints).forEach(key => (this.propCache[key] = Computable.resolve(constraints[key])));
  }

  public hasConstraints(constraints: Constraints): boolean {
    const k1 = Object.keys(this.constraints);
    const k2 = Object.keys(constraints);
    return k1.length === k2.length && k1.every(k => k in constraints && constraints[k] === this.constraints[k]);
  }

  public getPropertyWithOverrides(name: string, overrides: Constraints): Computable<Property> {
    const combined = { ...this.constraints, ...overrides };
    return this.model.getConfig(combined).getProperty(name);
  }

  public getTargetWithOverrides(name: string, overrides: Constraints): Computable<FileSource[]> {
    const combined = { ...this.constraints, ...overrides };
    return this.model.getConfig(combined).getTarget(name);
  }

  public getProperty(name: string, stack?: IDependencyStack): Computable<Property> {
    this.assertNonCircularProperty(name, stack);
    if (name in this.propCache) {
      /* Already seen */
      const result = this.propCache[name];
      if (result === null) {
        throw new Error("Circular dependency at '" + name + "'");
      } else {
        return result;
      }
    } else {
      const def = this.model.getDecl(name);
      if (!def || def.kind !== DeclKind.Property) {
        throw new Error("Unresolved property name '" + name + "'"); /* TODO: actual error reporting */
      }
      const result = this.resolveStringProperty(def, undefined, stack);
      this.propCache[name] = result;
      return result;
    }
  }

  public getTarget(name: string, stack?: IDependencyStack): Computable<FileSource[]> {
    this.assertNonCircularTarget(name, stack);
    if (name in this.targetCache) {
      /* Already seen */
      return this.targetCache[name];
    } else {
      const def = this.model.getDecl(name);
      if (def?.kind === DeclKind.Target) {
        const result = this.resolveTarget(def, stack).then(target => [target]);
        this.targetCache[name] = result;
        return result;
      } else if (def?.kind === DeclKind.Property) {
        const result = this.resolveFileProperty(def, undefined, stack);
        this.targetCache[name] = result;
        return result;
      } else {
        throw new Error("Unresolved name '" + name + "'"); /* TODO: actual error reporting */
      }
    }
  }

  /**
   * Find and return a target from the literal prefix of the given name, and return
   * a new Name representing the unmatched suffix. If no such target can be found,
   * returns undefined.
   *
   * e.g. given a name of "mylib/lib/*" and a declared target 'mylib', will return
   * the Computable for mylib and the remaining name "lib/*".
   *
   * Note: target names are not pattern matched against globs (ie only the literal prefix
   * of the name is looked up)
   */
  public getPrefixTargetIfExists(name: Name, stack?: IDependencyStack): [Computable<FileSource[]>, Name] | undefined {
    const result = this.model.getPrefixMatch(name);
    if (result) {
      console.log("Resolved " + name.toString() + " => " + result.decl.name + " - " + result.rest.toString());
      return [this.getTarget(result.decl.name, stack), result.rest];
    }
    return undefined;
  }

  public getCachedOrBuild(manifest: string, create: (targetDir: string) => Computable<FileSet>): Computable<FileSet> {
    return this.model.getBuildCache().getOrCreate(manifest, create);
  }

  private resolveStringProperty(prop: IPropertyDecl, target?: ITargetDecl, stack?: IDependencyStack): Computable<Property> {
    return Computable.forAll(
      prop.values.map(value => this.substituteNameVars(value.value, { property: prop, target, context: this, value, next: stack })),
      (...resolved) => new Property(resolved.map(name => name.toString()))
    );
  }

  private resolveFileProperty(prop: IPropertyDecl, target?: ITargetDecl, stack?: IDependencyStack): Computable<FileSource[]> {
    return Computable.forAll(
      prop.values.map(value =>
        this.resolveFileSource(value.value, prop, { property: prop, target, context: this, value, next: stack })
      ),
      (...resolved) => resolved.flat()
    );
  }

  /**
   * Resolve the Names as they appear in a target property list to their respective targets
   * (potentially causing them to be queued for evaluation)
   * @param name
   */
  private resolveFileSource(name: Name, relativeTo: INamedDecl, stack?: IDependencyStack): Computable<FileSource[]> {
    return this.substituteNameVars(name, stack).then(substName => {
      if (substName.isEmpty()) {
        return [];
      } else {
        const targetDep = this.getPrefixTargetIfExists(substName, stack);
        if (targetDep) {
          const [target, rest] = targetDep;
          if (rest.isEmpty()) {
            return target;
          } else {
            return target.then(t => FileSet.findAll(t, rest)).then(data => [data]);
          }
        } else {
          /* Not an identified target; check the filesystem relative to the target decl */
          const baseName = relativeTo.source.file;
          return relativeTo.source.fs.find(substName.relativeTo(baseName)).then(data => [data]);
        }
      }
    });
  }

  private substituteNameVars(name: Name, stack?: IDependencyStack): Computable<Name> {
    const vars = name.getVariables();
    return Computable.forAll(
      vars.map(varName => this.getProperty(varName, stack)),
      (...resolvedVars) => {
        const substName = name.substitute(
          vars,
          resolvedVars.map(prop => prop.toString())
        );
        return substName;
      }
    );
  }

  private resolveTarget(target: ITargetDecl, stack?: IDependencyStack): Computable<FileSource> {
    const targetDef = this.model.getTargetDef(target.type);
    if (!targetDef) {
      throw new Error("Targetdef '" + target.type + "' not found"); /* Can't happen due to earlier checks */
    }
    const rule = getTargetRule(target.type)!;
    if (!rule) {
      throw new Error(
        "No rule found to build '" +
          target.type +
          "'\n" +
          `    at ${target.name} (${stringifyLoc(target)})\n` +
          stringifyDependencyStack(stack)
      );
    }
    const resolvedProps = target.properties.map(prop => {
      const type = targetDef.properties[prop.name];
      switch (type.type) {
        case PropertyType.String:
        case PropertyType.StringList:
          return this.resolveStringProperty(prop, target, stack);
        case PropertyType.FileSet:
        case PropertyType.FileSetList:
          return this.resolveFileProperty(prop, target, stack);
        default:
          throw new Error("Unsupported property type");
      }
    });

    return Computable.forAll(resolvedProps, (...resolved) => {
      const resolvedTarget = target.properties.reduce<Record<string, Property | FileSource[]>>((m, k, idx) => {
        m[k.name] = resolved[idx];
        return m;
      }, {});
      return rule.evaluate(new ResolvedTarget(resolvedTarget), this);
    });
  }

  private findTargetInStack(target: string, stack?: IDependencyStack): IDependencyStack | undefined {
    let node = stack;
    while (node) {
      if (node.target && node.target.name === target && node.context === this) {
        return node;
      }
      node = node.next;
    }
  }

  private findPropertyInStack(property: string, stack?: IDependencyStack): IDependencyStack | undefined {
    let node = stack;
    while (node) {
      if (node.property.name === property && node.context === this) {
        return node;
      }
      node = node.next;
    }
  }

  private assertNonCircularProperty(property: string, stack?: IDependencyStack): void {
    const entry = this.findPropertyInStack(property, stack);
    if (entry) {
      throw new Error("Circular dependency resolving " + property + "\n" + stringifyDependencyStack(stack, entry));
    }
  }

  private assertNonCircularTarget(target: string, stack?: IDependencyStack): void {
    const entry = this.findTargetInStack(target, stack);
    if (entry) {
      throw new Error("Circular dependency resolving " + target + "\n" + stringifyDependencyStack(stack, entry));
    }
  }
}

/**
 * Construct a human readable dump of the stack.
 * @param stack start of the start to show.
 * @param end If supplied, the last entry of the stack to show.
 */
function stringifyDependencyStack(stack?: IDependencyStack, end?: IDependencyStack): string {
  let result = "";
  let node = stack;
  while (node && node !== end) {
    result += "    " + stringifyDependencyStackEntry(node) + "\n";
    node = node.next;
  }
  return result;
}

function stringifyDependencyStackEntry(entry: IDependencyStack): string {
  let name;
  if (entry.target) {
    name = entry.target.name + "." + entry.property.name;
  } else {
    name = entry.property.name;
  }
  return `at ${name} (${stringifyLoc(entry.value)})`;
}

function stringifyLoc(decl: IDecl): string {
  const loc = decl.source.reader.resolvePosition(decl.offset);
  return `${decl.source.file}:${loc?.line}:${loc?.column}`;
}
