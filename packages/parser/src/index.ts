import { Project, ts } from 'ts-morph';
import { opendir, realpath, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import {
  DEFAULT_EXCLUSIONS,
  validateParserOptions,
  type ParserAnalysis,
  type ParsedFile,
  type ParsedImport,
  type ParserOptions,
  type ParserProgress,
  type ImportResolution,
} from '@follo/shared';

export const PARSER_VERSION = '0.18.0';
export interface ParserLimits {
  maxEntries: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}
export const DEFAULT_LIMITS: ParserLimits = {
  maxEntries: 200000,
  maxFiles: 10000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};
const VIRTUAL_ROOT = '/repo';
const supported = /\.(?:ts|tsx|js|jsx)$/i;
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const slash = (value: string) => value.replace(/\\/g, '/');
const virtual = (relative: string) => path.posix.join(VIRTUAL_ROOT, slash(relative));
const relative = (file: string) => path.posix.relative(VIRTUAL_ROOT, file);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const lookupKey = (value: string) =>
  process.platform === 'win32' ? slash(value).toLowerCase() : slash(value);
const absolute = (value: string) =>
  value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value);

function inRoot(root: string, file: string): boolean {
  const rel = path.relative(root, file);

  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function virtualInRoot(file: string): boolean {
  return file === VIRTUAL_ROOT || file.startsWith(`${VIRTUAL_ROOT}/`);
}

function message(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

/** Parsing and resolution operate on an in-memory snapshot. No repository code is executed or emitted. */
export async function parseRepository(
  root: string,
  input: ParserOptions = { exclusions: DEFAULT_EXCLUSIONS },
  onProgress: (progress: ParserProgress) => void = () => {},
  limits: ParserLimits = DEFAULT_LIMITS,
): Promise<ParserAnalysis> {
  const canonicalRoot = await realpath(root);

  if (
    (process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot) !==
    (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root))
  ) {
    throw new Error('Repository path changed. Select the folder again before analysis.');
  }

  const startedAt = new Date().toISOString();
  const { exclusions } = validateParserOptions(input);
  const excluded = new Set(exclusions);
  const warnings: string[] = [];
  const candidates: string[] = [];
  const knownFiles = new Set<string>();
  const directories = new Set<string>([VIRTUAL_ROOT]);
  const excludedRoots: string[] = [];
  const blockedFiles = new Set<string>();
  let discoveryComplete = true;
  let entries = 0;
  let links = 0;
  const queue = [''];
  onProgress({
    stage: 'discover',
    completed: 0,
    total: null,
    message: 'Discovering local source files…',
  });

  discover: while (queue.length) {
    const current = queue.pop()!;
    const fullDirectory = path.join(canonicalRoot, current);

    try {
      if (!inRoot(canonicalRoot, await realpath(fullDirectory)))
        throw new Error('Directory moved outside repository');

      for await (const entry of await opendir(fullDirectory)) {
        if (++entries > limits.maxEntries) {
          discoveryComplete = false;
          warnings.push('Discovery entry limit reached; file coverage is partial.');
          break discover;
        }

        const rel = slash(path.join(current, entry.name));
        const file = virtual(rel);

        if (entry.isSymbolicLink()) {
          links++;
          blockedFiles.add(file);
          continue;
        }

        if (entry.isDirectory()) {
          if (excluded.has(entry.name)) excludedRoots.push(file);
          else {
            directories.add(file);
            queue.push(rel);
          }
        } else if (entry.isFile()) {
          knownFiles.add(file);

          if (supported.test(entry.name)) {
            if (candidates.length >= limits.maxFiles) {
              discoveryComplete = false;
              warnings.push('Source-file limit reached; file coverage is partial.');
              break discover;
            }

            candidates.push(file);
          }
        }

        if (entries % 1000 === 0)
          onProgress({
            stage: 'discover',
            completed: candidates.length,
            total: null,
            message: `${candidates.length} source files discovered`,
          });
      }
    } catch {
      discoveryComplete = false;
      excludedRoots.push(virtual(current));
      warnings.push(`Could not discover directory: ${current || '.'}`);
    }
  }

  candidates.sort();
  const indexedFiles = new Map([...knownFiles].map((file) => [lookupKey(file), file]));
  const indexedDirectories = new Set([...directories].map(lookupKey));
  if (links)
    warnings.push(`Skipped ${links} symbolic links. Linked source and configuration are not read.`);
  let bytes = 0;
  const snapshot = new Map<string, string>();
  const files: ParsedFile[] = [];
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      noLib: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
  });

  async function readSnapshot(file: string): Promise<{ text: string; buffer: Buffer }> {
    if (!virtualInRoot(file) || !knownFiles.has(file))
      throw new Error('File is outside the discovered repository scope.');
    const physical = path.join(canonicalRoot, relative(file));
    const canonical = await realpath(physical);
    if (!inRoot(canonicalRoot, canonical)) throw new Error('File points outside the repository.');
    const normalized = (value: string) =>
      process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalized(canonical) !== normalized(physical))
      throw new Error('File changed to a symbolic link.');
    const handle = await open(physical, 'r');

    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Not a regular file.');
      const openedPath = await realpath(physical);

      if (!inRoot(canonicalRoot, openedPath) || normalized(openedPath) !== normalized(physical)) {
        throw new Error('File scope changed while opening it.');
      }

      const namedInfo = await stat(openedPath);
      if (namedInfo.ino !== info.ino || namedInfo.dev !== info.dev)
        throw new Error('File was replaced while opening it.');
      if (info.size > limits.maxFileBytes)
        throw new Error(`File exceeds the ${limits.maxFileBytes} byte per-file limit.`);
      if (bytes + info.size > limits.maxTotalBytes)
        throw new Error('Analysis snapshot byte limit reached.');
      // Bound the actual read too, even if the file grows after stat.
      const buffer = Buffer.alloc(info.size + 1);
      let count = 0;

      while (count < buffer.length) {
        const read = await handle.read(buffer, count, buffer.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }

      bytes += count;
      const after = await handle.stat();
      if (count !== info.size || info.size !== after.size || info.mtimeMs !== after.mtimeMs)
        throw new Error('File changed while it was being read; rerun analysis.');
      const content = buffer.subarray(0, count);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
      snapshot.set(file, text);

      return { text, buffer: content };
    } finally {
      await handle.close();
    }
  }

  onProgress({
    stage: 'parse',
    completed: 0,
    total: candidates.length,
    message: 'Parsing source files…',
  });

  for (const [index, file] of candidates.entries()) {
    const fact: ParsedFile = {
      id: hash(relative(file)),
      path: relative(file),
      hash: null,
      linesOfCode: null,
      status: 'skipped',
      imports: [],
      diagnostics: [],
    };

    try {
      const { text, buffer } = await readSnapshot(file);
      fact.hash = hash(buffer);
      fact.linesOfCode = text.length
        ? text.split(/\r\n|\r|\n/).length - Number(/(?:\r\n|\r|\n)$/.test(text))
        : 0;
      project.createSourceFile(file, text);
      fact.status = 'parsed';
    } catch (error) {
      fact.diagnostics.push({
        line: null,
        message: error instanceof Error ? error.message : 'Could not parse source file.',
      });
    }

    files.push(fact);
    if (index % 25 === 0 || index === candidates.length - 1)
      onProgress({
        stage: 'parse',
        completed: index + 1,
        total: candidates.length,
        message: `Parsed ${index + 1} / ${candidates.length} source files`,
      });
  }

  // Preload only package manifests and compiler configurations; TypeScript never reads the real filesystem.
  const invalidManifests = new Set<string>();
  const packages = new Map<
    string,
    {
      name: string;
      declarations: { manifest: string; kind: string; version: string }[];
      importedBy: number;
      builtin: boolean;
    }
  >();
  let manifestCount = 0;

  for (const file of [...knownFiles].filter(
    (file) => path.posix.basename(file) === 'package.json',
  )) {
    try {
      const { text } = await readSnapshot(file);
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('Invalid manifest');
      manifestCount++;

      for (const kind of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        const declarations = (value as Record<string, unknown>)[kind];
        if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations))
          continue;

        for (const [name, version] of Object.entries(declarations)) {
          if (
            !/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]{1,214}$/.test(name) ||
            typeof version !== 'string'
          )
            continue;
          const entry = packages.get(name) ?? {
            name,
            declarations: [],
            importedBy: 0,
            builtin: false,
          };
          entry.declarations.push({
            manifest: relative(file),
            kind,
            version: version.slice(0, 300),
          });
          packages.set(name, entry);
        }
      }
    } catch {
      invalidManifests.add(path.posix.dirname(file));
      warnings.push(`Package manifest is invalid or inaccessible: ${relative(file)}`);
    }
  }

  const configs = new Map<string, { options: ts.CompilerOptions; valid: boolean }>();
  const configRoots = [...knownFiles].filter((file) =>
    /^(?:tsconfig|jsconfig)(?:\..+)?\.json$/.test(path.posix.basename(file)),
  );
  const configLoading = new Set<string>();
  const unsupportedConfigs = new Set<string>();

  async function loadConfig(file: string): Promise<void> {
    if (snapshot.has(file) || configLoading.has(file)) return;
    configLoading.add(file);

    try {
      const { text } = await readSnapshot(file);
      const json = ts.parseConfigFileTextToJson(file, text);
      const rawOptions = json.config?.compilerOptions;
      const absoluteOption =
        ['baseUrl', 'rootDir', 'outDir'].some(
          (key) => typeof rawOptions?.[key] === 'string' && absolute(rawOptions[key]),
        ) ||
        (Array.isArray(rawOptions?.rootDirs) &&
          rawOptions.rootDirs.some(
            (value: unknown) => typeof value === 'string' && absolute(value),
          )) ||
        (rawOptions?.paths &&
          typeof rawOptions.paths === 'object' &&
          Object.values(rawOptions.paths).some(
            (values) =>
              Array.isArray(values) &&
              values.some((value) => typeof value === 'string' && absolute(value)),
          ));
      if (absoluteOption) unsupportedConfigs.add(file);
      const extensions = json.config?.extends;

      for (const extension of Array.isArray(extensions) ? extensions : [extensions]) {
        if (typeof extension === 'string' && absolute(extension)) {
          unsupportedConfigs.add(file);
          continue;
        }

        if (typeof extension !== 'string' || !extension.startsWith('.')) continue;
        const target = path.posix.resolve(path.posix.dirname(file), extension);
        const expanded = knownFiles.has(target) ? target : `${target}.json`;

        if (virtualInRoot(expanded) && knownFiles.has(expanded)) {
          await loadConfig(expanded);
          if (unsupportedConfigs.has(expanded)) unsupportedConfigs.add(file);
        }
      }
    } catch {
      warnings.push(`Could not read compiler configuration: ${relative(file)}`);
    } finally {
      configLoading.delete(file);
    }
  }

  const defaultOptions: ts.CompilerOptions = {
    allowJs: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.Latest,
  };
  const host: ts.ModuleResolutionHost = {
    fileExists: (file) => virtualInRoot(slash(file)) && indexedFiles.has(lookupKey(file)),
    readFile: (file) => snapshot.get(indexedFiles.get(lookupKey(file)) ?? slash(file)),
    directoryExists: (directory) => indexedDirectories.has(lookupKey(directory)),
    getCurrentDirectory: () => VIRTUAL_ROOT,
    realpath: (file) => indexedFiles.get(lookupKey(file)) ?? slash(file),
    useCaseSensitiveFileNames: process.platform !== 'win32',
  };

  for (const file of configRoots.sort()) {
    await loadConfig(file);
    const text = snapshot.get(file);

    if (text === undefined) {
      configs.set(file, { options: defaultOptions, valid: false });
      continue;
    }

    const json = ts.parseConfigFileTextToJson(file, text);
    const parsed = ts.parseJsonConfigFileContent(
      json.config ?? {},
      {
        useCaseSensitiveFileNames: process.platform !== 'win32',
        fileExists: host.fileExists,
        readFile: host.readFile,
        readDirectory: (directory) =>
          candidates.filter((candidate) => candidate.startsWith(`${slash(directory)}/`)),
      },
      path.posix.dirname(file),
      undefined,
      file,
    );
    const errors = [
      ...(json.error ? [json.error] : []),
      ...parsed.errors.filter((error) => error.code !== 18003),
    ];
    if (errors.length)
      warnings.push(...errors.map((error) => `${relative(file)}: ${message(error)}`));
    if (unsupportedConfigs.has(file))
      warnings.push(
        `${relative(file)}: Absolute compiler-resolution paths are unsupported in snapshot analysis; imports remain unresolved.`,
      );
    configs.set(file, {
      options: { ...defaultOptions, ...parsed.options },
      valid: !errors.length && !unsupportedConfigs.has(file),
    });
  }

  function configuration(file: string) {
    let current = path.posix.dirname(file);

    while (virtualInRoot(current)) {
      const config =
        configs.get(`${current}/tsconfig.json`) ?? configs.get(`${current}/jsconfig.json`);
      if (config) return config;
      if (current === VIRTUAL_ROOT) break;
      current = path.posix.dirname(current);
    }

    return { options: defaultOptions, valid: true };
  }

  const factsByPath = new Map(files.map((file) => [virtual(file.path), file]));

  function classify(
    specifier: string | null,
    source: string,
    kind: ParsedImport['kind'],
  ): ImportResolution {
    if (specifier === null)
      return {
        status: 'skipped',
        reason: 'Computed module expression cannot be resolved statically.',
      };
    const config = configuration(source);
    if (!config.valid)
      return {
        status: 'unresolved',
        reason:
          'Compiler configuration is invalid, inaccessible, or unsupported; resolution is not trustworthy.',
      };
    let lookupSpecifier = specifier;

    if (absolute(specifier)) {
      const physical = path.resolve(specifier);
      if (!inRoot(canonicalRoot, physical))
        return {
          status: 'skipped',
          reason: 'Absolute import points outside the selected repository.',
        };
      lookupSpecifier = virtual(path.relative(canonicalRoot, physical));
    }

    const nodeMode =
      config.options.moduleResolution === ts.ModuleResolutionKind.Node16 ||
      config.options.moduleResolution === ts.ModuleResolutionKind.NodeNext;

    if (
      (nodeMode || specifier.startsWith('#')) &&
      [...invalidManifests].some((directory) => source.startsWith(`${directory}/`))
    ) {
      return {
        status: 'unresolved',
        reason:
          'Package manifest is invalid or inaccessible; module conditions cannot be verified.',
      };
    }

    const mode =
      kind === 'require'
        ? ts.ModuleKind.CommonJS
        : kind === 'dynamic'
          ? ts.ModuleKind.ESNext
          : nodeMode
            ? ts.getImpliedNodeFormatForFile(source, undefined, host, config.options)
            : ts.ModuleKind.ESNext;
    const result = ts.resolveModuleName(
      lookupSpecifier,
      source,
      config.options,
      host,
      undefined,
      undefined,
      mode,
    ).resolvedModule;

    if (result) {
      const target =
        indexedFiles.get(lookupKey(result.resolvedFileName)) ?? slash(result.resolvedFileName);
      const fact = factsByPath.get(target);
      if (fact?.status === 'parsed') return { status: 'resolved', targetPath: fact.path };

      return {
        status: 'skipped',
        reason: fact
          ? 'Target source file could not be parsed.'
          : 'Target is not a supported source file in this analysis.',
      };
    }

    const isRelative =
      specifier.startsWith('.') || specifier.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(specifier);

    if (isRelative) {
      const target = path.posix.resolve(path.posix.dirname(source), slash(specifier));
      if (!virtualInRoot(target))
        return { status: 'skipped', reason: 'Import points outside the selected repository.' };

      if (
        excludedRoots.some((folder) => target === folder || target.startsWith(`${folder}/`)) ||
        blockedFiles.has(target) ||
        [...blockedFiles].some((file) => target.startsWith(`${file}/`))
      ) {
        return {
          status: 'skipped',
          reason: 'Import targets an excluded directory or symbolic link.',
        };
      }

      if (knownFiles.has(target) && !supported.test(target))
        return { status: 'skipped', reason: 'Import targets an unsupported file type.' };

      return {
        status: 'unresolved',
        reason: 'TypeScript could not resolve the internal module in the discovered snapshot.',
      };
    }

    const aliases = Object.keys(config.options.paths ?? {});
    if (
      specifier.startsWith('#') ||
      aliases.some((pattern) => {
        const star = pattern.indexOf('*');

        return star < 0
          ? pattern === specifier
          : specifier.startsWith(pattern.slice(0, star)) &&
              specifier.endsWith(pattern.slice(star + 1));
      })
    )
      return {
        status: 'unresolved',
        reason: 'Configured alias or package import could not be resolved.',
      };
    if (specifier.startsWith('node:'))
      return builtins.has(specifier.slice(5))
        ? { status: 'external', packageName: specifier }
        : { status: 'unresolved', reason: 'Unknown Node.js built-in module.' };
    if (builtins.has(specifier)) return { status: 'external', packageName: specifier };
    const parts = specifier.split('/');
    const packageName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];

    if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(packageName)) {
      return { status: 'unresolved', reason: 'Unsupported module specifier.' };
    }

    return { status: 'external', packageName };
  }

  onProgress({
    stage: 'resolve',
    completed: 0,
    total: files.length,
    message: 'Extracting and resolving imports…',
  });
  let syntaxErrors = 0;
  const searchDocuments: NonNullable<ParserAnalysis['searchDocuments']> = [];

  for (const [index, fact] of files.entries()) {
    if (fact.status === 'parsed') {
      const source = project.getSourceFileOrThrow(virtual(fact.path));
      const ast = source.compilerNode;
      const symbolNames = new Set<string>();
      const diagnostics = project.getProgram().compilerObject.getSyntacticDiagnostics(ast);
      if (diagnostics.length) syntaxErrors++;
      fact.diagnostics.push(
        ...diagnostics.map((diagnostic) => ({
          line:
            diagnostic.start === undefined
              ? null
              : ast.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
          message: message(diagnostic),
        })),
      );

      function add(
        kind: ParsedImport['kind'],
        expression: ts.Node | undefined,
        node: ts.Node,
        shadowed = false,
      ) {
        const specifier = expression && ts.isStringLiteralLike(expression) ? expression.text : null;
        fact.imports.push({
          kind,
          specifier,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          resolution: shadowed
            ? {
                status: 'skipped',
                reason: 'require is locally declared; this is not a verified CommonJS import.',
              }
            : diagnostics.length
              ? {
                  status: 'skipped',
                  reason: 'Source has syntax errors; relationship is not verified.',
                }
              : classify(
                  specifier,
                  virtual(fact.path),
                  ts.isImportEqualsDeclaration(node) ? 'require' : kind,
                ),
        });
      }

      function visit(node: ts.Node) {
        if (
          (ts.isClassDeclaration(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isVariableDeclaration(node) ||
            ts.isMethodDeclaration(node)) &&
          node.name
        ) {
          const name = node.name.getText(ast);
          symbolNames.add(name);
          symbolNames.add(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
        }

        if (ts.isImportDeclaration(node)) add('import', node.moduleSpecifier, node);
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
          add('reexport', node.moduleSpecifier, node);
        else if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference)
        )
          add('import', node.moduleReference.expression, node);
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
          add('import-type', node.argument.literal, node);
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          add('dynamic', node.arguments[0], node);
        else if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'
        ) {
          const symbol = source.getDescendantAtPos(node.expression.getStart(ast))?.getSymbol();
          add(
            'require',
            node.arguments[0],
            node,
            Boolean(
              symbol
                ?.getDeclarations()
                .some((declaration) => declaration.getSourceFile() === source),
            ),
          );
        }

        ts.forEachChild(node, visit);
      }

      visit(ast);
      searchDocuments.push({
        fileId: fact.id,
        path: fact.path,
        symbols: [...symbolNames].join('\n'),
        source: source.getFullText(),
      });
    }

    if (index % 25 === 0 || index === files.length - 1)
      onProgress({
        stage: 'resolve',
        completed: index + 1,
        total: files.length,
        message: `Resolved imports in ${index + 1} / ${files.length} files`,
      });
  }

  const imports = files.flatMap((file) => file.imports);

  for (const file of files) {
    const names = new Set(
      file.imports.flatMap((item) => {
        if (item.resolution.status !== 'external') return [];
        const name = item.resolution.packageName;

        return [
          name.startsWith('node:') || builtins.has(name)
            ? `node:${name.replace(/^node:/, '')}`
            : name,
        ];
      }),
    );

    for (const rawName of names) {
      const builtin = rawName.startsWith('node:') || builtins.has(rawName);
      const name = builtin ? `node:${rawName.replace(/^node:/, '')}` : rawName;
      const entry = packages.get(name) ?? { name, declarations: [], importedBy: 0, builtin };
      entry.importedBy++;
      packages.set(name, entry);
    }
  }

  const result: ParserAnalysis = {
    parserVersion: PARSER_VERSION,
    root: canonicalRoot,
    startedAt,
    completedAt: new Date().toISOString(),
    exclusions,
    files,
    warnings,
    searchDocuments,
    techStack: {
      packages: [...packages.values()].sort(
        (a, b) => b.importedBy - a.importedBy || a.name.localeCompare(b.name),
      ),
      manifests: manifestCount,
    },
    coverage: {
      filesDiscovered: files.length,
      filesParsed: files.filter((file) => file.status === 'parsed').length,
      filesSkipped: files.filter((file) => file.status === 'skipped').length,
      filesWithSyntaxErrors: syntaxErrors,
      importsDiscovered: imports.length,
      internalResolved: imports.filter((item) => item.resolution.status === 'resolved').length,
      external: imports.filter((item) => item.resolution.status === 'external').length,
      skipped: imports.filter((item) => item.resolution.status === 'skipped').length,
      unresolved: imports.filter((item) => item.resolution.status === 'unresolved').length,
      discoveryComplete,
    },
  };
  onProgress({
    stage: 'complete',
    completed: files.length,
    total: files.length,
    message: 'Parser analysis complete.',
  });

  return result;
}
