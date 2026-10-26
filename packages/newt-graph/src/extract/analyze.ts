import { realpathSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { ContextNode, Edge, EdgeKind, EventNode, Graph, Location, ModuleDep, ModuleNode, RouteNode, SubscriptionNode, UseCaseNode, Warning } from '../model'
import { isUnder, openProgram, type AppProgram } from './program'

export type AnalyzeOptions = {
  /** The folder of the application's backend: every module, context and worker under it is analysed. */
  root: string
  /** Its tsconfig; the nearest one above the root by default (a solution is followed to the project that holds the root). */
  tsconfig?: string
  /** What every file is relative to; the current folder by default. */
  base?: string
  /** newt's sources; found by resolving `newt/core` from the root by default. */
  framework?: string
  /** Analyse test files and `testing/` helpers too, their nodes marked `test`. */
  tests?: boolean
  /** Which contexts each one may use (newt-eslint's `contexts.uses`). */
  uses?: Record<string, string[]>
  name?: string
}

/** A test, or a helper of tests, by its path under the root. */
const TEST_FILE = /(\.test|\.spec)\.[cm]?[jt]sx?$|(^|[\\/])(testing|tests?|__tests__|fixtures?)[\\/]/
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
const MAX_DEPTH = 40

type FunctionNode = ts.FunctionLikeDeclaration & { body: ts.Node }

type UseCaseInfo = { name: string, decl: ts.MethodDeclaration, writesTo: string[], retryOnConflict: boolean }

type ModuleClass = {
  decl: ts.ClassDeclaration
  className: string
  name: string
  dir: string
  test: boolean
  useCases: Map<string, UseCaseInfo>
  /** Its schedules: the property that holds one, and the schedule's name and cron. */
  schedules: { name: string, cron: string, at: ts.Node }[]
  /** The event classes its `eventsOf` offers. */
  eventClasses: ts.ClassDeclaration[]
}

type EventClass = { decl: ts.ClassDeclaration, name: string }

type Instance = { id: string, cls: ModuleClass, call: ts.CallExpression, context: string }

/** What a function does, as written: the use cases it calls, the events it tells, and what it calls that is only known per instance. */
type Effect =
  | { kind: 'useCase', cls: ModuleClass, useCase: string, receiver: ts.Expression | null, at: ts.Node }
  | { kind: 'emit', event: EventClass, at: ts.Node }
  | { kind: 'dynamic', callee: ts.Expression, via: string | null, at: ts.Node }

type Resolved = { calls: { to: string, at: ts.Node, via: string | null }[], emits: { to: string, at: ts.Node }[] }

const strip = (node: ts.Node): ts.Node => {
  let current = node
  while (
    ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)
    || ts.isAwaitExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)
  ) current = current.expression
  return current
}

const literal = (node: ts.Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined

const propertyName = (name: ts.PropertyName | ts.BindingName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) || ts.isNumericLiteral(name) ? name.text : undefined

const hasBody = (node: ts.Node): node is FunctionNode =>
  (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    || ts.isGetAccessorDeclaration(node) || ts.isConstructorDeclaration(node)) && node.body !== undefined

const objectProperty = (object: ts.ObjectLiteralExpression, name: string) =>
  object.properties.find(each => each.name && propertyName(each.name) === name)

/** Reads a newt application: its contexts, modules, use cases, events, workers and routes, and how they reach each other. */
export function analyze(options: AnalyzeOptions): Graph {
  const app = openProgram(options)
  return new Analyzer(app, options).run()
}

class Analyzer {
  private readonly checker: ts.TypeChecker
  private readonly base: string
  private readonly root: string
  private readonly tests: boolean
  private readonly sources: ts.SourceFile[]
  private readonly warnings: Warning[] = []

  private readonly moduleClasses = new Map<ts.ClassDeclaration, ModuleClass>()
  private readonly eventClasses = new Map<ts.ClassDeclaration, EventClass>()
  private readonly callSites = new Map<ts.Node, (ts.CallExpression | ts.NewExpression)[]>()
  private readonly instancesByCall = new Map<ts.CallExpression, Instance[]>()
  private readonly instances: Instance[] = []
  private readonly effectsMemo = new Map<ts.Node, Effect[]>()
  private readonly computing = new Set<ts.Node>()

  private readonly contexts = new Map<string, ContextNode>()
  private readonly events = new Map<string, EventNode>()
  private readonly edges = new Map<string, Edge>()

  constructor(private readonly app: AppProgram, private readonly options: AnalyzeOptions) {
    this.checker = app.checker
    this.base = resolve(options.base ?? process.cwd())
    this.tests = options.tests ?? false
    this.root = realRoot(options.root)
    this.sources = app.files.filter(file => this.tests || !this.isTestFile(file.fileName))
  }

  run(): Graph {
    for (const file of this.sources) this.index(file)
    this.findContexts()
    this.findInstances()
    const modules = this.instances.map(instance => this.moduleNode(instance))
    const useCases = this.instances.flatMap(instance => [...instance.cls.useCases.values()].map(useCase => this.useCaseNode(instance, useCase)))
    this.findEvents()
    for (const instance of this.instances) this.useCaseEdges(instance)
    const subscriptions = this.findSubscriptions()
    const routes = this.findRoutes()
    const known = new Set([...modules.map(each => each.id), ...useCases.map(each => each.id), ...this.events.keys(), ...routes.map(each => each.id), ...this.contexts.keys()])
    const edges = [...this.edges.values()].filter(edge => known.has(edge.from) && known.has(edge.to))
    const root = this.root
    return {
      version: 1,
      app: {
        name: this.options.name ?? appName(root),
        base: this.base,
        root: relative(this.base, root) || '.',
        tsconfig: relative(this.base, this.app.tsconfig),
        generatedAt: new Date().toISOString(),
        tests: this.tests,
      },
      contexts: [...this.contexts.values()].sort((a, b) => a.name.localeCompare(b.name)),
      modules,
      useCases,
      events: [...this.events.values()],
      subscriptions,
      routes,
      edges,
      warnings: this.warnings,
    }
  }

  // ---------------------------------------------------------------- reading the code

  private loc(node: ts.Node): Location {
    const file = node.getSourceFile()
    return { file: relative(this.base, file.fileName), line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1 }
  }

  private warn(node: ts.Node, message: string): void {
    this.warnings.push({ ...this.loc(node), message })
  }

  private isTest(node: ts.Node): boolean {
    return this.isTestFile(node.getSourceFile().fileName)
  }

  private isTestFile(fileName: string): boolean {
    return TEST_FILE.test(relative(this.root, resolve(fileName)))
  }

  private isFramework(decl: ts.Node): boolean {
    return isUnder(resolve(decl.getSourceFile().fileName), this.app.frameworkDir)
  }

  private isApp(decl: ts.Node): boolean {
    const file = decl.getSourceFile()
    return !file.isDeclarationFile && !this.isFramework(decl) && !file.fileName.includes(`${sep}node_modules${sep}`)
  }

  private symbolOf(node: ts.Node): ts.Symbol | undefined {
    const target = ts.isPropertyAccessExpression(node) ? node.name : node
    let symbol = this.checker.getSymbolAtLocation(target)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol)
    return symbol
  }

  /** `Class.member` (or `name`) of a declaration of newt's, else undefined. */
  private frameworkName(decl: ts.Node): string | undefined {
    if (!this.isFramework(decl)) return undefined
    const named = (decl as ts.NamedDeclaration).name
    const name = named && ts.isIdentifier(named) ? named.text : undefined
    const owner = decl.parent && (ts.isClassDeclaration(decl.parent) || ts.isInterfaceDeclaration(decl.parent)) ? decl.parent.name?.text : undefined
    return owner ? `${owner}.${name}` : name
  }

  /** Whether a class extends one of newt's (`Module`, `Base`), however far up. */
  private extendsFramework(decl: ts.ClassDeclaration, name: string): boolean {
    const seen = new Set<ts.Type>()
    const walk = (type: ts.Type): boolean => {
      if (seen.has(type)) return false
      seen.add(type)
      const bases = type.isClassOrInterface() ? this.checker.getBaseTypes(type) : []
      return bases.some(base => {
        const declaration = base.symbol?.declarations?.[0]
        if (declaration && this.frameworkName(declaration) === name) return true
        return walk(base)
      })
    }
    return walk(this.checker.getTypeAtLocation(decl))
  }

  private index(file: ts.SourceFile): void {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) {
        const eventName = this.staticEventName(node)
        if (eventName) this.eventClasses.set(node, { decl: node, name: eventName })
        else if (this.extendsFramework(node, 'Module')) this.moduleClasses.set(node, this.readModuleClass(node))
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) this.indexCallSite(node)
      ts.forEachChild(node, visit)
    }
    visit(file)
  }

  private staticEventName(decl: ts.ClassDeclaration): string | undefined {
    for (const member of decl.members) {
      if (ts.isPropertyDeclaration(member) && member.modifiers?.some(each => each.kind === ts.SyntaxKind.StaticKeyword) && member.name && propertyName(member.name) === 'eventName') {
        return literal(member.initializer)
      }
    }
    return undefined
  }

  /** The function a call reaches, by the declarations of what it calls: where its arguments flow. */
  private calledFunction(node: ts.CallExpression | ts.NewExpression): ts.Node | undefined {
    const symbol = this.symbolOf(strip(node.expression))
    const decl = symbol?.declarations?.[0]
    if (!decl) return undefined
    if (ts.isNewExpression(node)) {
      if (!ts.isClassDeclaration(decl)) return undefined
      return decl.members.find(ts.isConstructorDeclaration) ?? decl
    }
    return this.functionOf(decl)
  }

  private functionOf(decl: ts.Node): FunctionNode | undefined {
    if (hasBody(decl)) return decl
    if ((ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl) || ts.isPropertyDeclaration(decl)) && decl.initializer) {
      const value = strip(decl.initializer)
      if (hasBody(value)) return value
    }
    return undefined
  }

  private indexCallSite(node: ts.CallExpression | ts.NewExpression): void {
    const fn = this.calledFunction(node)
    if (!fn || !this.isApp(fn)) return
    const sites = this.callSites.get(fn) ?? []
    sites.push(node)
    this.callSites.set(fn, sites)
  }

  private readModuleClass(decl: ts.ClassDeclaration): ModuleClass {
    const className = decl.name!.text
    const ctor = decl.members.find(ts.isConstructorDeclaration)
    let name: string | undefined
    const schedules: ModuleClass['schedules'] = []
    const eventClasses: ts.ClassDeclaration[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.SuperKeyword) name ??= literal(node.arguments[0])
        const callee = this.symbolOf(strip(node.expression))?.declarations?.[0]
        const framework = callee && this.frameworkName(callee)
        if (framework === 'eventsOf' && node.arguments[1] && ts.isObjectLiteralExpression(strip(node.arguments[1]))) {
          for (const property of (strip(node.arguments[1]) as ts.ObjectLiteralExpression).properties) {
            const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined
            const cls = value && this.symbolOf(strip(value))?.declarations?.find(ts.isClassDeclaration)
            if (cls) eventClasses.push(cls)
          }
        }
        if (framework === 'Schedules.define') {
          const scheduleName = literal(node.arguments[0])
          if (scheduleName) schedules.push({ name: scheduleName, cron: literal(node.arguments[1]) ?? '?', at: node })
        }
      }
      ts.forEachChild(node, visit)
    }
    if (ctor) visit(ctor)
    for (const member of decl.members) if (ts.isPropertyDeclaration(member) && member.initializer) visit(member.initializer)
    const useCases = new Map<string, UseCaseInfo>()
    for (const member of decl.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue
      const options = this.useCaseOptions(member)
      const useCaseName = propertyName(member.name)
      if (options && useCaseName) useCases.set(useCaseName, { name: useCaseName, decl: member, ...options })
    }
    return {
      decl,
      className,
      name: name ?? className.replace(/_Module$/, '').replace(/^./, first => first.toLowerCase()),
      dir: dirname(resolve(decl.getSourceFile().fileName)),
      test: this.isTest(decl),
      useCases,
      schedules,
      eventClasses,
    }
  }

  /** `@UseCase(…)`'s options, if the method has it. */
  private useCaseOptions(method: ts.MethodDeclaration): { writesTo: string[], retryOnConflict: boolean } | undefined {
    for (const decorator of ts.getDecorators(method) ?? []) {
      const expression = strip(decorator.expression)
      const callee = ts.isCallExpression(expression) ? expression.expression : expression
      const decl = this.symbolOf(strip(callee))?.declarations?.[0]
      if (!decl || this.frameworkName(decl) !== 'UseCase') continue
      const argument = ts.isCallExpression(expression) ? expression.arguments[0] : undefined
      const object = argument && ts.isObjectLiteralExpression(strip(argument)) ? strip(argument) as ts.ObjectLiteralExpression : undefined
      const writesTo = object && objectProperty(object, 'writesTo')
      const retry = object && objectProperty(object, 'retryOnConflict')
      return {
        writesTo: writesTo && ts.isPropertyAssignment(writesTo) && ts.isArrayLiteralExpression(strip(writesTo.initializer))
          ? (strip(writesTo.initializer) as ts.ArrayLiteralExpression).elements.map(each => literal(each)).filter((each): each is string => each !== undefined)
          : [],
        retryOnConflict: !(retry && ts.isPropertyAssignment(retry) && retry.initializer.kind === ts.SyntaxKind.FalseKeyword),
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------- where values come from

  /**
   * The expressions a value may come from, followed through variables, properties of
   * object literals, parameters (to their call sites), functions' returns and
   * properties set in a constructor. `instance` narrows a module's `initialize` to
   * that instance's call: `this.deps.column` in one context is that context's column.
   */
  private stop: ((node: ts.Node) => boolean) | undefined

  /** `origins`, stopping where `stop` says: at `tenant.events`, to tell whose events a port is. */
  private originsStoppingAt(node: ts.Node, instance: Instance | undefined, stop: (node: ts.Node) => boolean): ts.Node[] {
    this.stop = stop
    try {
      return this.origins(node, instance)
    } finally {
      this.stop = undefined
    }
  }

  private origins(node: ts.Node, instance: Instance | undefined, depth = 0, seen = new Set<ts.Node>()): ts.Node[] {
    const value = strip(node)
    if (depth > MAX_DEPTH || seen.has(value)) return []
    seen.add(value)
    if (this.stop?.(value)) return [value]
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
      const symbol = this.symbolOf(value)
      if (!symbol?.declarations?.length) {
        return ts.isPropertyAccessExpression(value)
          ? this.originsOfProperty(this.origins(value.expression, instance, depth + 1, seen), value.name.text, instance, depth + 1, seen)
          : [value]
      }
      const found = symbol.declarations.flatMap(decl => this.originsOfDecl(decl, value, instance, depth + 1, seen))
      return found.length ? found : [value]
    }
    if (ts.isCallExpression(value)) {
      if (this.instancesByCall.has(value) || this.isInitializeCall(value)) return [value]
      const decl = this.symbolOf(strip(value.expression))?.declarations?.[0]
      const fn = decl && this.functionOf(decl)
      if (fn && this.isApp(fn) && !(ts.isMethodDeclaration(fn) && this.useCaseOptions(fn))) {
        const returned = this.returnsOf(fn)
        if (returned.length) return returned.flatMap(each => this.origins(each, instance, depth + 1, seen))
      }
      return [value]
    }
    if (ts.isConditionalExpression(value)) {
      return [...this.origins(value.whenTrue, instance, depth + 1, seen), ...this.origins(value.whenFalse, instance, depth + 1, seen)]
    }
    if (ts.isBinaryExpression(value) && (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || value.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return [...this.origins(value.left, instance, depth + 1, seen), ...this.origins(value.right, instance, depth + 1, seen)]
    }
    return [value]
  }

  private originsOfDecl(decl: ts.Declaration, reference: ts.Node, instance: Instance | undefined, depth: number, seen: Set<ts.Node>): ts.Node[] {
    if (ts.isVariableDeclaration(decl)) return decl.initializer ? this.origins(decl.initializer, instance, depth, seen) : []
    if (ts.isBindingElement(decl)) {
      const name = propertyName(decl.propertyName ?? decl.name)
      const holder = decl.parent.parent
      if (!name || !ts.isObjectBindingPattern(decl.parent)) return [decl]
      if (ts.isVariableDeclaration(holder) && holder.initializer) {
        return this.originsOfProperty(this.origins(holder.initializer, instance, depth, seen), name, instance, depth, seen)
      }
      if (ts.isParameter(holder)) return this.originsOfProperty(this.originsOfParameter(holder, instance, depth, seen), name, instance, depth, seen)
      return [decl]
    }
    if (ts.isParameter(decl)) {
      const found = this.originsOfParameter(decl, instance, depth, seen)
      return found.length ? found : [decl]
    }
    if (ts.isShorthandPropertyAssignment(decl)) {
      const symbol = this.checker.getShorthandAssignmentValueSymbol(decl)
      return (symbol?.declarations ?? []).flatMap(each => this.originsOfDecl(each, decl.name, instance, depth, seen))
    }
    if (ts.isPropertyAssignment(decl)) return this.origins(decl.initializer, instance, depth, seen)
    if (ts.isPropertyDeclaration(decl)) {
      if (decl.initializer) return this.origins(decl.initializer, instance, depth, seen)
      const assigned = this.assignedInClass(decl)
      if (assigned.length) return assigned.flatMap(each => this.origins(each, instance, depth, seen))
    }
    if ((ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl) || ts.isMethodSignature(decl)) && ts.isPropertyAccessExpression(reference) && decl.name) {
      const name = propertyName(decl.name)
      if (name) return this.originsOfProperty(this.origins(reference.expression, instance, depth, seen), name, instance, depth, seen)
    }
    return [decl]
  }

  private originsOfParameter(param: ts.ParameterDeclaration, instance: Instance | undefined, depth: number, seen: Set<ts.Node>): ts.Node[] {
    const fn = param.parent
    if (!ts.isFunctionLike(fn)) return []
    const index = fn.parameters.indexOf(param)
    let sites: (ts.CallExpression | ts.NewExpression)[] = this.callSites.get(fn) ?? []
    // A module's `initialize`, for one instance: that instance's call only.
    if (instance && ts.isMethodDeclaration(fn) && fn.parent === instance.cls.decl && propertyName(fn.name) === 'initialize') sites = [instance.call]
    return sites.flatMap(site => {
      const argument = site.arguments?.[index]
      return argument ? this.origins(argument, instance, depth, seen) : []
    })
  }

  private originsOfProperty(objects: ts.Node[], name: string, instance: Instance | undefined, depth: number, seen: Set<ts.Node>): ts.Node[] {
    return objects.flatMap(object => {
      if (ts.isObjectLiteralExpression(object)) {
        for (const property of [...object.properties].reverse()) {
          if (ts.isSpreadAssignment(property)) {
            const spread = this.originsOfProperty(this.origins(property.expression, instance, depth + 1, seen), name, instance, depth + 1, seen)
            if (spread.length) return spread
            continue
          }
          if (!property.name || propertyName(property.name) !== name) continue
          if (ts.isPropertyAssignment(property)) return this.origins(property.initializer, instance, depth + 1, seen)
          if (ts.isShorthandPropertyAssignment(property)) return this.originsOfDecl(property, property.name, instance, depth + 1, seen)
          return [property]
        }
        return []
      }
      const type = ts.isClassDeclaration(object) ? undefined : this.checker.getTypeAtLocation(object)
      const property = type?.getProperty(name)
      return (property?.declarations ?? []).flatMap(decl => {
        if (ts.isPropertySignature(decl) || ts.isMethodSignature(decl)) return []
        if (ts.isParameter(decl) || ts.isPropertyDeclaration(decl) || ts.isPropertyAssignment(decl) || ts.isShorthandPropertyAssignment(decl)) {
          return this.originsOfDecl(decl, decl, instance, depth + 1, seen)
        }
        return [decl]
      })
    })
  }

  /** What a constructor assigns to a property declared without a value: `this.events = eventsOf(…)`. */
  private assignedInClass(decl: ts.PropertyDeclaration): ts.Expression[] {
    const cls = decl.parent
    const name = decl.name && propertyName(decl.name)
    if (!ts.isClassDeclaration(cls) || !name) return []
    const found: ts.Expression[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)
        && node.left.expression.kind === ts.SyntaxKind.ThisKeyword && node.left.name.text === name) found.push(node.right)
      ts.forEachChild(node, visit)
    }
    for (const member of cls.members) if (ts.isConstructorDeclaration(member)) visit(member)
    return found
  }

  private returnsOf(fn: FunctionNode): ts.Expression[] {
    if (!ts.isBlock(fn.body)) return [fn.body as ts.Expression]
    const found: ts.Expression[] = []
    const visit = (node: ts.Node): void => {
      if (hasBody(node) || ts.isClassDeclaration(node)) return
      if (ts.isReturnStatement(node) && node.expression) found.push(node.expression)
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(fn.body, visit)
    return found
  }

  private isInitializeCall(call: ts.CallExpression): ModuleClass | undefined {
    const callee = strip(call.expression)
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'initialize') return undefined
    const cls = this.symbolOf(callee.expression)?.declarations?.find(ts.isClassDeclaration)
    return cls && this.moduleClasses.get(cls)
  }

  // ---------------------------------------------------------------- contexts and their modules

  /** `new <Base subclass>({ name: 'boards', … })`: each one opens a context. */
  private findContexts(): void {
    for (const file of this.sources) {
      const visit = (node: ts.Node): void => {
        const name = ts.isNewExpression(node) ? this.contextNameOf(node) : undefined
        if (name && !this.contexts.has(name)) {
          this.contexts.set(name, { id: name, name, ...this.loc(node), uses: this.options.uses?.[name] ?? null })
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
  }

  private contextNameOf(node: ts.NewExpression): string | undefined {
    const cls = this.symbolOf(strip(node.expression))?.declarations?.find(ts.isClassDeclaration)
    if (!cls) return undefined
    const isBase = this.frameworkName(cls) === 'Base' || this.extendsFramework(cls, 'Base')
    const options = node.arguments?.[0] && strip(node.arguments[0])
    if (!isBase || !options || !ts.isObjectLiteralExpression(options)) return undefined
    const name = objectProperty(options, 'name')
    return name && ts.isPropertyAssignment(name) ? literal(strip(name.initializer)) : undefined
  }

  /** The context a module is initialized in: the name of the `Base` its `initialize` is given, else the `contexts/<name>/` folder it is in. */
  private contextsOfBase(call: ts.CallExpression): string[] {
    const argument = call.arguments[0]
    const named = argument ? this.origins(argument, undefined).filter(ts.isNewExpression).map(each => this.contextNameOf(each)).filter((each): each is string => each !== undefined) : []
    if (named.length) return [...new Set(named)]
    const match = /[\\/]contexts[\\/]([^\\/]+)[\\/]/.exec(call.getSourceFile().fileName)
    const name = match?.[1] ?? 'app'
    if (!this.contexts.has(name)) this.contexts.set(name, { id: name, name, ...this.loc(call), uses: this.options.uses?.[name] ?? null })
    return [name]
  }

  private findInstances(): void {
    for (const file of this.sources) {
      const visit = (node: ts.Node): void => {
        const cls = ts.isCallExpression(node) ? this.isInitializeCall(node) : undefined
        // A module's own `initialize` calling another's is wiring too; its own `initialize` calling itself is not.
        if (cls && ts.isCallExpression(node)) {
          const instances = this.contextsOfBase(node).map(context => {
            let id = `${context}/${cls.name}`
            for (let n = 2; this.instances.some(each => each.id === id); n++) id = `${context}/${cls.name}#${n}`
            const instance: Instance = { id, cls, call: node, context }
            this.instances.push(instance)
            return instance
          })
          this.instancesByCall.set(node, instances)
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    for (const cls of this.moduleClasses.values()) {
      if (!cls.test && !this.instances.some(each => each.cls === cls)) this.warn(cls.decl, `${cls.className} is never initialized: it is left out`)
    }
  }

  private instancesOf(cls: ModuleClass): Instance[] {
    return this.instances.filter(each => each.cls === cls)
  }

  /**
   * The instances a receiver is: `this` is the caller, a value that comes from an
   * `initialize` is that one; otherwise every instance of its class, those of the
   * caller's context first (a value picked at run time, `outboxes[name]`, is any).
   */
  private resolveInstances(receiver: ts.Expression | null, cls: ModuleClass, caller: Instance | undefined): Instance[] {
    if (!receiver || strip(receiver).kind === ts.SyntaxKind.ThisKeyword) {
      if (caller?.cls === cls) return [caller]
    } else {
      const fromOrigins = this.origins(receiver, caller)
        .flatMap(origin => origin.kind === ts.SyntaxKind.ThisKeyword && caller?.cls === cls ? [caller] : ts.isCallExpression(origin) ? this.instancesByCall.get(origin) ?? [] : [])
        .filter(each => each.cls === cls)
      if (fromOrigins.length) return this.preferContext([...new Set(fromOrigins)], caller)
    }
    const all = this.instancesOf(cls)
    if (all.length <= 1 || (receiver && this.isDynamic(receiver))) return all
    return this.preferContext(all, caller)
  }

  private preferContext(instances: Instance[], caller: Instance | undefined): Instance[] {
    const same = instances.filter(each => each.context === caller?.context)
    return same.length ? same : instances
  }

  private isDynamic(node: ts.Node): boolean {
    let dynamic = false
    const visit = (each: ts.Node): void => {
      if (ts.isElementAccessExpression(each)) dynamic = true
      else ts.forEachChild(each, visit)
    }
    visit(node)
    return dynamic
  }

  private moduleNode(instance: Instance): ModuleNode {
    const { cls } = instance
    return {
      id: instance.id,
      context: instance.context,
      name: cls.name,
      className: cls.className,
      ...this.loc(cls.decl.name ?? cls.decl),
      initializedAt: this.loc(instance.call),
      test: cls.test || this.isTest(instance.call),
      deps: this.depsOf(instance),
    }
  }

  /** What a module is given at `initialize`: each a module, or a port, and where its deps type says it. */
  private readonly depsMemo = new Map<Instance, ModuleDep[]>()

  private depsOf(instance: Instance): ModuleDep[] {
    const memo = this.depsMemo.get(instance)
    if (memo) return memo
    const deps = this.readDeps(instance)
    this.depsMemo.set(instance, deps)
    return deps
  }

  private readDeps(instance: Instance): ModuleDep[] {
    // `initialize(base, deps?, options?)`: the parameter named `deps`, or typed `<M>_Deps`.
    const initialize = this.symbolOf(strip(instance.call.expression))?.declarations?.find(ts.isMethodDeclaration)
    const index = initialize?.parameters.findIndex(param => propertyName(param.name) === 'deps' || /Deps\b/.test(param.type?.getText() ?? '')) ?? -1
    const argument = index >= 0 && instance.call.arguments[index] ? strip(instance.call.arguments[index]) : undefined
    if (!argument || !ts.isObjectLiteralExpression(argument)) return []
    const depsType = this.checker.getTypeAtLocation(initialize!.parameters[index]!)
    const deps: ModuleDep[] = []
    const add = (name: string, value: ts.Expression, at: ts.Node) => {
      const declared = depsType?.getProperty(name.split('.')[0]!)?.declarations?.[0]
      const location = this.loc(declared ?? at)
      const type = this.checker.getTypeAtLocation(value)
      const cls = this.moduleClassOfType(type)
      if (cls) {
        for (const target of this.resolveInstances(value, cls, instance)) deps.push({ name, kind: 'module', target: target.id, ...location })
        return
      }
      if (!name.includes('.')) {
        const nested = type.getProperties().filter(property => {
          const decl = property.valueDeclaration ?? property.declarations?.[0]
          return decl && this.moduleClassOfType(this.checker.getTypeOfSymbolAtLocation(property, decl))
        })
        if (nested.length && nested.length === type.getProperties().length) {
          for (const property of nested) {
            const decl = property.valueDeclaration ?? property.declarations![0]!
            const target = this.moduleClassOfType(this.checker.getTypeOfSymbolAtLocation(property, decl))!
            const origins = this.originsOfProperty(this.origins(value, instance), property.name, instance, 0, new Set())
              .flatMap(origin => ts.isCallExpression(origin) ? this.instancesByCall.get(origin) ?? [] : [])
              .filter(each => each.cls === target)
            const targets = origins.length ? this.preferContext(origins, instance) : this.resolveInstances(null, target, undefined)
            for (const each of targets) deps.push({ name: `${name}.${property.name}`, kind: 'module', target: each.id, ...location })
          }
          return
        }
      }
      // A port: another module's events (`tenant.events`), or an object in the module's own words.
      const behind = this.originsStoppingAt(value, instance, node => ts.isPropertyAccessExpression(node) && node.name.text === 'events').flatMap(origin => {
        if (ts.isPropertyAccessExpression(origin) && origin.name.text === 'events') {
          return this.origins(origin.expression, instance).flatMap(each => ts.isCallExpression(each) ? this.instancesByCall.get(each) ?? [] : [])
        }
        return []
      })
      deps.push({ name, kind: 'port', target: behind[0]?.id ?? null, ...location })
    }
    for (const property of argument.properties) {
      if (ts.isPropertyAssignment(property) && property.name) add(propertyName(property.name) ?? '?', property.initializer, property)
      else if (ts.isShorthandPropertyAssignment(property)) add(property.name.text, property.name, property)
    }
    return deps
  }

  private moduleClassOfType(type: ts.Type): ModuleClass | undefined {
    const decl = type.symbol?.declarations?.find(ts.isClassDeclaration)
    return decl && this.moduleClasses.get(decl)
  }

  private useCaseNode(instance: Instance, useCase: UseCaseInfo): UseCaseNode {
    return {
      id: `${instance.id}.${useCase.name}`,
      module: instance.id,
      context: instance.context,
      name: useCase.name,
      writesTo: useCase.writesTo,
      retryOnConflict: useCase.retryOnConflict,
      ...this.loc(useCase.decl.name),
    }
  }

  // ---------------------------------------------------------------- events

  /** The module class whose events an event class is: the one whose `eventsOf` offers it, else the module of its folder. */
  private ownerOfEvent(event: ts.ClassDeclaration): ModuleClass | undefined {
    for (const cls of this.moduleClasses.values()) if (cls.eventClasses.includes(event)) return cls
    const dir = dirname(resolve(event.getSourceFile().fileName))
    return this.moduleClassIn(basename(dir) === 'events' ? dirname(dir) : dir)
  }

  private moduleClassIn(dir: string): ModuleClass | undefined {
    for (const cls of this.moduleClasses.values()) if (cls.dir === dir) return cls
    return undefined
  }

  private findEvents(): void {
    for (const event of this.eventClasses.values()) {
      const owner = this.ownerOfEvent(event.decl)
      if (!owner) {
        if (!this.isTest(event.decl)) this.warn(event.decl, `${event.name} belongs to no module it could find: it is left out`)
        continue
      }
      for (const instance of this.instancesOf(owner)) {
        const id = `${instance.context}/${event.name}`
        if (!this.events.has(id)) {
          this.events.set(id, { id, name: event.name, module: instance.id, context: instance.context, className: event.decl.name!.text, schedule: null, ...this.loc(event.decl.name!) })
        }
      }
    }
    for (const instance of this.instances) {
      for (const schedule of instance.cls.schedules) {
        const id = `${instance.context}/${schedule.name}`
        this.events.set(id, { id, name: schedule.name, module: instance.id, context: instance.context, className: null, schedule: { cron: schedule.cron }, ...this.loc(schedule.at) })
      }
    }
  }

  /** The events of that name a module may mean: its own, else its context's, else any. */
  private eventsNamed(name: string, caller: Instance | undefined): EventNode[] {
    const all = [...this.events.values()].filter(each => each.name === name)
    const own = all.filter(each => each.module === caller?.id)
    if (own.length) return own
    const same = all.filter(each => each.context === caller?.context)
    return same.length ? same : all
  }

  // ---------------------------------------------------------------- what code does

  /** What a function does, following what it calls in the application that is no use case. */
  private effects(fn: ts.Node): Effect[] {
    const memo = this.effectsMemo.get(fn)
    if (memo) return memo
    if (this.computing.has(fn)) return []
    this.computing.add(fn)
    const found: Effect[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return
      if (ts.isNewExpression(node)) {
        const cls = this.symbolOf(strip(node.expression))?.declarations?.find(ts.isClassDeclaration)
        const event = cls && this.eventClasses.get(cls)
        if (event) found.push({ kind: 'emit', event, at: node })
      }
      if (ts.isCallExpression(node)) this.callEffects(node, found)
      ts.forEachChild(node, visit)
    }
    const body = hasBody(fn) ? fn.body : fn
    visit(body)
    this.computing.delete(fn)
    this.effectsMemo.set(fn, found)
    return found
  }

  private callEffects(call: ts.CallExpression, found: Effect[]): void {
    const callee = strip(call.expression)
    if (callee.kind === ts.SyntaxKind.SuperKeyword || callee.kind === ts.SyntaxKind.ImportKeyword) return
    const symbol = this.symbolOf(callee)
    const decls = symbol?.declarations ?? []
    if (decls.length === 0) {
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee) || ts.isIdentifier(callee)) found.push({ kind: 'dynamic', callee: callee as ts.Expression, via: null, at: call })
      return
    }
    const decl = decls[0]!
    if (!this.isApp(decl)) return
    if (ts.isMethodDeclaration(decl) && ts.isClassDeclaration(decl.parent)) {
      const cls = this.moduleClasses.get(decl.parent)
      const name = propertyName(decl.name)
      if (cls && name && cls.useCases.has(name)) {
        found.push({ kind: 'useCase', cls, useCase: name, receiver: ts.isPropertyAccessExpression(callee) ? callee.expression : null, at: call })
        return
      }
      if (cls && name === 'initialize') return
    }
    const fn = this.functionOf(decl)
    if (fn) {
      found.push(...this.effects(fn))
      return
    }
    found.push({ kind: 'dynamic', callee: callee as ts.Expression, via: this.portName(decl), at: call })
  }

  /** `Workspaces.isMember`: the member of a port (a type in the module's own words) a call goes through. */
  private portName(decl: ts.Declaration): string | null {
    if (!(ts.isPropertySignature(decl) || ts.isMethodSignature(decl)) || !decl.name) return null
    const owner = decl.parent
    const ownerName = ts.isInterfaceDeclaration(owner) ? owner.name.text : ts.isTypeLiteralNode(owner) && ts.isTypeAliasDeclaration(owner.parent) ? owner.parent.name.text : undefined
    return ownerName ? `${ownerName}.${propertyName(decl.name)}` : null
  }

  /** What a function does in one instance: the use cases it calls and the events it tells, each by id. */
  private resolve(effects: Effect[], instance: Instance | undefined, depth = 0, seen = new Set<ts.Node>(), via: string | null = null): Resolved {
    const resolved: Resolved = { calls: [], emits: [] }
    for (const effect of effects) {
      if (effect.kind === 'useCase') {
        for (const target of this.resolveInstances(effect.receiver, effect.cls, instance)) {
          resolved.calls.push({ to: `${target.id}.${effect.useCase}`, at: effect.at, via })
        }
      } else if (effect.kind === 'emit') {
        const owner = this.ownerOfEvent(effect.event.decl)
        const emitters = owner === instance?.cls && instance ? [instance] : owner ? this.preferContext(this.instancesOf(owner), instance) : []
        for (const emitter of emitters) resolved.emits.push({ to: `${emitter.context}/${effect.event.name}`, at: effect.at })
      } else if (depth < 8) {
        for (const origin of this.origins(effect.callee, instance)) {
          const fn = this.functionOf(origin) ?? (hasBody(origin) ? origin : undefined)
          if (!fn || seen.has(fn) || !this.isApp(fn)) continue
          seen.add(fn)
          if (ts.isMethodDeclaration(fn) && ts.isClassDeclaration(fn.parent) && this.moduleClasses.get(fn.parent)?.useCases.has(propertyName(fn.name) ?? '')) {
            const cls = this.moduleClasses.get(fn.parent)!
            for (const target of this.resolveInstances(null, cls, instance)) resolved.calls.push({ to: `${target.id}.${propertyName(fn.name)}`, at: effect.at, via: via ?? effect.via })
            continue
          }
          const inner = this.resolve(this.effects(fn), instance, depth + 1, seen, via ?? effect.via)
          resolved.calls.push(...inner.calls.map(each => ({ ...each, at: effect.at })))
          resolved.emits.push(...inner.emits.map(each => ({ ...each, at: effect.at })))
        }
      }
    }
    return resolved
  }

  private edge(kind: EdgeKind, from: string, to: string, at: ts.Node | Location, extra: Partial<Edge> = {}): void {
    const id = `${kind}:${from}->${to}${extra.via ? `@${extra.via}` : ''}`
    if (this.edges.has(id)) return
    const location = 'line' in at && typeof at.line === 'number' ? { file: (at as Location).file, line: at.line } : this.loc(at as ts.Node)
    this.edges.set(id, { id, kind, from, to, async: false, via: null, ...location, ...extra })
  }

  private useCaseEdges(instance: Instance): void {
    for (const useCase of instance.cls.useCases.values()) {
      const from = `${instance.id}.${useCase.name}`
      const { calls, emits } = this.resolve(this.effects(useCase.decl), instance)
      for (const call of calls) if (call.to !== from) this.edge('calls', from, call.to, call.at, { via: call.via })
      for (const emit of emits) this.edge('emits', from, emit.to, emit.at)
      for (const target of useCase.writesTo) {
        const module = this.instances.find(each => each.context === instance.context && each.cls.name === target)
        if (module) this.edge('writesTo', from, module.id, useCase.decl.name)
        else this.warn(useCase.decl, `${from} writesTo '${target}', which is no module of ${instance.context}`)
      }
    }
    for (const dep of this.depsOf(instance)) {
      if (dep.target && dep.target !== instance.id) this.edge('depends', instance.id, dep.target, dep, { via: dep.kind === 'port' ? dep.name : null })
    }
  }

  // ---------------------------------------------------------------- workers

  private findSubscriptions(): SubscriptionNode[] {
    const subscriptions: SubscriptionNode[] = []
    for (const file of this.sources) {
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) subscriptions.push(...this.subscription(node))
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    return subscriptions
  }

  private subscription(call: ts.CallExpression): SubscriptionNode[] {
    const callee = strip(call.expression)
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'subscribe') return []
    const decl = this.symbolOf(callee)?.declarations?.[0]
    if (!decl || this.frameworkName(decl) !== 'DomainEventEmitter.subscribe') return []
    const [handler, optionsNode] = call.arguments
    const options = optionsNode && strip(optionsNode)
    if (!handler || !options || !ts.isObjectLiteralExpression(options)) {
      this.warn(call, 'A subscription whose options are not written in place: left out')
      return []
    }
    const read = (key: string) => {
      const property = objectProperty(options, key)
      return property && ts.isPropertyAssignment(property) ? strip(property.initializer) : undefined
    }
    const strategy = literal(read('strategy')) === 'handler' ? 'handler' : 'fire-and-forget'
    const queue = literal(read('queue')) ?? null
    const attemptsNode = read('attempts')
    const attempts = attemptsNode && ts.isNumericLiteral(attemptsNode) ? Number(attemptsNode.text) : strategy === 'handler' ? 5 : null
    const filtered = objectProperty(options, 'when') !== undefined
    const handlerFns = this.origins(handler, undefined).map(each => this.functionOf(each) ?? (hasBody(each) ? each : undefined)).filter(each => each !== undefined)
    const effects = handlerFns.flatMap(fn => this.effects(fn))

    const owner = this.moduleClassIn(dirname(resolve(call.getSourceFile().fileName)))
      ?? effects.find(each => each.kind === 'useCase')?.cls
    if (!owner) {
      this.warn(call, 'A subscription of no module: left out')
      return []
    }
    const found: SubscriptionNode[] = []
    for (const instance of this.instancesOf(owner)) {
      const eventName = queue && queue.includes('.on.') ? queue.slice(queue.indexOf('.on.') + 4) : this.eventNameOf(callee.expression, instance)
      if (!eventName) {
        this.warn(call, `A ${strategy} of ${instance.id} on an event it could not tell: left out`)
        continue
      }
      const events = this.eventsBehind(callee.expression, eventName, instance)
      if (events.length === 0) {
        this.warn(call, `${instance.id} subscribes to ${eventName}, which no module tells`)
        continue
      }
      const handlers = [...new Set(this.resolve(effects, instance).calls.map(each => each.to))]
      for (const event of events) {
        const base = queue ? `${instance.context}/${queue}` : `${instance.context}/${instance.cls.name}.on.${eventName}:${this.loc(call).line}`
        const id = events.length > 1 ? `${base}@${event.context}` : base
        found.push({
          id,
          event: event.id,
          module: instance.id,
          context: instance.context,
          handlers,
          strategy,
          queue,
          attempts,
          filtered,
          runsIn: event.context,
          test: owner.test || this.isTest(call),
          ...this.loc(call),
        })
        for (const target of handlers) this.edge('triggers', event.id, target, call, { async: true, via: id, strategy })
      }
    }
    return found
  }

  /** The event an emitter is, followed to its class (`created: Card_Created`) or its schedule. */
  private eventNameOf(emitter: ts.Expression, instance: Instance): string | undefined {
    for (const origin of this.origins(emitter, instance)) {
      if (ts.isClassDeclaration(origin)) {
        const event = this.eventClasses.get(origin)
        if (event) return event.name
      }
      if (ts.isCallExpression(origin)) {
        const decl = this.symbolOf(strip(origin.expression))?.declarations?.[0]
        if (decl && this.frameworkName(decl) === 'Schedules.define') return literal(origin.arguments[0])
      }
    }
    return undefined
  }

  /** The event nodes a subscription listens to: of the module its emitter comes from when it can tell, else by name. */
  private eventsBehind(emitter: ts.Expression, name: string, instance: Instance): EventNode[] {
    const all = [...this.events.values()].filter(each => each.name === name)
    if (all.length <= 1) return all
    // `deps.card.events.created`: the instance behind `deps.card`.
    const holder = ts.isPropertyAccessExpression(strip(emitter)) ? (strip(emitter) as ts.PropertyAccessExpression).expression : undefined
    const owner = holder && ts.isPropertyAccessExpression(strip(holder)) && (strip(holder) as ts.PropertyAccessExpression).name.text === 'events'
      ? (strip(holder) as ts.PropertyAccessExpression).expression : holder
    if (owner) {
      const behind = this.origins(owner, instance).flatMap(origin => origin.kind === ts.SyntaxKind.ThisKeyword ? [instance] : ts.isCallExpression(origin) ? this.instancesByCall.get(origin) ?? [] : [])
      const events = all.filter(event => behind.some(each => each.id === event.module))
      if (events.length) return events
    }
    return this.eventsNamed(name, instance)
  }

  // ---------------------------------------------------------------- routes

  private findRoutes(): RouteNode[] {
    const routes = new Map<string, RouteNode>()
    for (const file of this.sources) {
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) for (const route of this.route(node)) if (!routes.has(route.id)) routes.set(route.id, route)
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    return [...routes.values()]
  }

  private route(call: ts.CallExpression): RouteNode[] {
    const callee = strip(call.expression)
    if (!ts.isPropertyAccessExpression(callee) || !(HTTP_METHODS as readonly string[]).includes(callee.name.text)) return []
    const decl = this.symbolOf(callee)?.declarations?.[0]
    const framework = decl && this.frameworkName(decl)
    if (framework !== `HttpRouter.${callee.name.text}` && framework !== `HttpGroup.${callee.name.text}`) return []
    const path = literal(call.arguments[0]) ?? '?'
    const handler = call.arguments[1]
    const method = callee.name.text.toUpperCase() as RouteNode['method']
    const owner = this.moduleClassIn(dirname(resolve(call.getSourceFile().fileName)))
    const instances: (Instance | undefined)[] = owner ? this.instancesOf(owner) : [undefined]
    return instances.flatMap(instance => {
      const context = instance?.context ?? /[\\/]contexts[\\/]([^\\/]+)[\\/]/.exec(call.getSourceFile().fileName)?.[1]
      if (!context) return []
      const { prefix, middleware } = this.prefixOf(callee.expression, instance)
      const fns = [...(handler ? this.origins(handler, instance) : []), ...middleware]
        .map(each => this.functionOf(each) ?? (hasBody(each) ? each : undefined)).filter(each => each !== undefined)
      const useCases = [...new Set(fns.flatMap(fn => this.resolve(this.effects(fn), instance).calls.map(each => each.to)))]
      const fullPath = `${prefix}${path}`
      const id = `${context}/${method} ${fullPath}`
      for (const useCase of useCases) this.edge('routes', id, useCase, call)
      return [{ id, method, path: fullPath, module: instance?.id ?? null, context, useCases, ...this.loc(call) }]
    })
  }

  /** A router's or group's prefix, the router's included (`/api` unless it says), and its groups' middleware. */
  private prefixOf(receiver: ts.Expression, instance: Instance | undefined, depth = 0): { prefix: string, middleware: ts.Node[] } {
    if (depth > 5) return { prefix: '?', middleware: [] }
    for (const origin of this.origins(receiver, instance)) {
      if (ts.isNewExpression(origin)) {
        const cls = this.symbolOf(strip(origin.expression))?.declarations?.[0]
        if (cls && this.frameworkName(cls) === 'HttpRouter') {
          const options = origin.arguments?.[0] && strip(origin.arguments[0])
          const prefix = options && ts.isObjectLiteralExpression(options) ? objectProperty(options, 'prefix') : undefined
          return { prefix: prefix && ts.isPropertyAssignment(prefix) ? literal(strip(prefix.initializer)) ?? '?' : '/api', middleware: [] }
        }
      }
      if (ts.isCallExpression(origin)) {
        const callee = strip(origin.expression)
        const decl = this.symbolOf(callee)?.declarations?.[0]
        if (decl && this.frameworkName(decl) === 'HttpRouter.group' && ts.isPropertyAccessExpression(callee)) {
          const outer = this.prefixOf(callee.expression, instance, depth + 1)
          const middleware = origin.arguments[1] ? this.origins(origin.arguments[1], instance) : []
          return { prefix: `${outer.prefix}${literal(origin.arguments[0]) ?? '?'}`, middleware: [...outer.middleware, ...middleware] }
        }
      }
    }
    return { prefix: '?', middleware: [] }
  }
}

function realRoot(root: string): string {
  try {
    return realpathSync(resolve(root))
  } catch {
    return resolve(root)
  }
}

/** The application's name: its root folder's, or its parent's when the root is only `backend`, `src` or the like. */
function appName(root: string): string {
  const generic = new Set(['backend', 'src', 'server', 'app', 'api'])
  const name = basename(root)
  return generic.has(name) ? basename(dirname(root)) : name
}
