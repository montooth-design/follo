import { access, lstat, opendir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LocalDatabase } from '@follo/database';
import { validateRepositoryId, type Repository } from '@follo/shared';

export const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
]);
const execute = promisify(execFile);
type GitRunner = (directory: string, args: string[]) => Promise<string>;

async function gitExecutable(directory: string): Promise<string> {
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const folder = entry.replace(/^"|"$/g, '');
    if (!path.isAbsolute(folder)) continue;
    const candidate = path.join(folder, process.platform === 'win32' ? 'git.exe' : 'git');

    try {
      const resolved = await realpath(candidate);
      const relative = path.relative(directory, resolved);
      if (
        relative === '' ||
        (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      )
        continue;
      await access(resolved, constants.X_OK);

      return resolved;
    } catch {
      /* Try the next absolute PATH entry. */
    }
  }

  throw Object.assign(new Error('Git is unavailable.'), { code: 'ENOENT' });
}

/** Only fixed read-only Git commands use this runner. No shell or repository executables. */
export const runGit: GitRunner = async (directory, args) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
  const result = await execute(
    await gitExecutable(directory),
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: directory,
      shell: false,
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    },
  );

  return result.stdout.trim();
};

function failureCode(error: unknown): string | number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error.code as string | number)
    : undefined;
}

export async function inspectGit(
  directory: string,
  warnings: string[],
  runner = runGit,
): Promise<Repository['git']> {
  const git: Repository['git'] = {
    status: 'not-repository',
    root: null,
    branch: null,
    commit: null,
    detached: false,
    workingTree: 'unknown',
  };

  try {
    git.root = await runner(directory, ['rev-parse', '--show-toplevel']);
    git.status = 'repository';
  } catch (error) {
    if (failureCode(error) === 'ENOENT') {
      git.status = 'unavailable';
      warnings.push('Git is not installed or is unavailable on PATH. Source folders still work.');
    } else if (!(
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      String(error.stderr).includes('not a git repository')
    )) {
      git.status = 'error';
      warnings.push(
        'Git metadata could not be inspected (permissions, repository trust, or command failure).',
      );
    }

    return git;
  }

  try {
    git.branch = await runner(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch (error) {
    if (failureCode(error) === 1) git.detached = true;
    else warnings.push('Git branch could not be read.');
  }

  try {
    git.commit = await runner(directory, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch (error) {
    if (failureCode(error) !== 1) warnings.push('Git commit could not be read.');
  }

  try {
    // Avoid inspecting submodule repositories, which may have independent configuration.
    git.workingTree = (await runner(directory, [
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
      '--ignore-submodules=all',
    ]))
      ? 'modified'
      : 'clean';
  } catch {
    warnings.push(
      'Working-tree status is unknown: Git status failed or exceeded its time/output limit.',
    );
  }

  return git;
}

export interface InspectionLimits {
  maxEntries: number;
  maxMilliseconds: number;
}
const DEFAULT_LIMITS: InspectionLimits = { maxEntries: 100000, maxMilliseconds: 10000 };

/** Directory metadata only: no source reads, config execution, or source modifications. */
export async function inspectRepository(
  selectedPath: string,
  limits = DEFAULT_LIMITS,
  gitRunner = runGit,
): Promise<Omit<Repository, 'id' | 'lastOpenedAt'>> {
  let directory: string;

  try {
    directory = await realpath(selectedPath);
    if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory');
  } catch {
    throw new Error('This folder is missing or inaccessible. Choose an existing source folder.');
  }

  const warnings: string[] = [];
  const project: Repository['project'] = {
    packageJson: false,
    tsconfigJson: false,
    jsconfigJson: false,
    typescriptFiles: 0,
    javascriptFiles: 0,
    sourceFiles: 0,
    scanComplete: true,
    skippedSymlinks: 0,
  };

  async function rootFile(name: string): Promise<boolean> {
    try {
      return (await lstat(path.join(directory, name))).isFile();
    } catch (error) {
      if (failureCode(error) !== 'ENOENT')
        warnings.push(`Could not inspect root configuration: ${name}`);

      return false;
    }
  }

  [project.packageJson, project.tsconfigJson, project.jsconfigJson] = await Promise.all([
    rootFile('package.json'),
    rootFile('tsconfig.json'),
    rootFile('jsconfig.json'),
  ]);
  if (await rootFile('.gitmodules'))
    warnings.push('Working-tree status excludes submodule contents and commit changes.');
  const queue = [directory];
  const started = Date.now();
  let entries = 0;

  scan: while (queue.length) {
    const current = queue.pop()!;

    try {
      const handle = await opendir(current);

      for await (const entry of handle) {
        if (++entries > limits.maxEntries || Date.now() - started > limits.maxMilliseconds) {
          project.scanComplete = false;
          warnings.push(
            'File counting reached its inspection limit. Displayed counts are a lower bound.',
          );
          break scan;
        }

        if (entry.isSymbolicLink()) {
          project.skippedSymlinks++;
          continue;
        }

        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(entry.name)) queue.push(path.join(current, entry.name));
          continue;
        }

        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (extension === '.ts' || extension === '.tsx') project.typescriptFiles++;
        if (extension === '.js' || extension === '.jsx') project.javascriptFiles++;
      }
    } catch {
      project.scanComplete = false;
      if (warnings.length < 30)
        warnings.push(`Could not read directory: ${path.relative(directory, current) || '.'}`);
    }
  }

  project.sourceFiles = project.typescriptFiles + project.javascriptFiles;
  if (project.skippedSymlinks)
    warnings.push(
      `Skipped ${project.skippedSymlinks} symbolic links to keep inspection within the chosen folder.`,
    );
  const git = await inspectGit(directory, warnings, gitRunner);

  return {
    path: directory,
    name: path.basename(directory) || directory,
    inspectedAt: new Date().toISOString(),
    project,
    git,
    warnings,
  };
}

export class RepositoryService {
  private busy = false;
  constructor(private readonly database: LocalDatabase) {}

  async open(pickFolder: () => Promise<string | null>): Promise<Repository | null> {
    return this.exclusive(async () => {
      const chosen = await pickFolder();

      return chosen === null ? null : this.inspectAndRemember(chosen);
    });
  }

  async reopen(input: unknown): Promise<Repository> {
    const id = validateRepositoryId(input);
    const stored = this.database.getRepository(id);
    if (!stored)
      throw new Error('Repository is not in the recent list. Choose it using the folder picker.');

    return this.exclusive(async () => {
      let currentPath: string;

      try {
        currentPath = await realpath(stored.path);
      } catch {
        throw new Error(
          'This folder is missing or inaccessible. Choose an existing source folder.',
        );
      }

      const normalize = (value: string) =>
        process.platform === 'win32' ? value.toLowerCase() : value;

      if (normalize(currentPath) !== normalize(stored.path)) {
        throw new Error(
          'This folder now points to a different location. Select it again using the folder picker.',
        );
      }

      return this.inspectAndRemember(stored.path);
    });
  }

  private async inspectAndRemember(selectedPath: string): Promise<Repository> {
    const metadata = await inspectRepository(selectedPath);
    const stored = this.database.rememberRepository({
      id: randomUUID(),
      name: metadata.name,
      path: metadata.path,
      lastOpenedAt: new Date().toISOString(),
    });

    return { ...metadata, ...stored };
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Another repository inspection is already in progress.');
    this.busy = true;

    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
}
