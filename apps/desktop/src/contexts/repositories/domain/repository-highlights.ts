import type { AnalysisSummary } from '@follo/shared';

export interface RepositoryHighlight {
  id: string;
  title: string;
  icon: string;
  files: { id: string; path: string }[];
  packages: { name: string; importedBy: number }[];
}
const rules = [
  {
    id: 'auth',
    title: 'Authentication',
    icon: '⌑',
    tokens: [
      'auth',
      'authentication',
      'authorization',
      'oauth',
      'signin',
      'login',
      'session',
      'jwt',
      'passport',
      'clerk',
    ],
    packages:
      /^(?:@auth\/|@clerk\/|@auth0\/|next-auth$|passport(?:-|$)|jsonwebtoken$|jose$|better-auth$|lucia$)/,
  },
  {
    id: 'payments',
    title: 'Payments & billing',
    icon: '$',
    tokens: [
      'payment',
      'payments',
      'billing',
      'checkout',
      'stripe',
      'invoice',
      'invoices',
      'subscription',
      'subscriptions',
    ],
    packages: /^(?:stripe$|@stripe\/|braintree$|@paypal\/|paddle|@paddle\/|razorpay$)/,
  },
  {
    id: 'database',
    title: 'Database',
    icon: '▤',
    tokens: [
      'database',
      'db',
      'repository',
      'repositories',
      'prisma',
      'drizzle',
      'sequelize',
      'mongoose',
      'knex',
      'typeorm',
    ],
    packages:
      /^(?:@prisma\/|prisma$|drizzle-orm$|pg$|postgres$|mysql2?$|sqlite3$|better-sqlite3$|mongoose$|mongodb$|sequelize$|typeorm$|knex$|node:sqlite$)/,
  },
  {
    id: 'schema',
    title: 'Schema & validation',
    icon: '{ }',
    tokens: [
      'schema',
      'schemas',
      'migration',
      'migrations',
      'validator',
      'validators',
      'validation',
      'dto',
    ],
    packages: /^(?:zod$|yup$|joi$|ajv$|valibot$|@sinclair\/typebox$|class-validator$)/,
  },
  {
    id: 'api',
    title: 'APIs & routing',
    icon: '⇄',
    tokens: [
      'api',
      'routes',
      'router',
      'routers',
      'controller',
      'controllers',
      'endpoint',
      'endpoints',
      'graphql',
      'trpc',
    ],
    packages: /^(?:express$|fastify$|hono$|koa$|graphql$|@trpc\/|@nestjs\/|@apollo\/)/,
  },
  {
    id: 'jobs',
    title: 'Background jobs',
    icon: '◷',
    tokens: [
      'job',
      'jobs',
      'queue',
      'queues',
      'worker',
      'workers',
      'cron',
      'scheduler',
      'schedulers',
    ],
    packages: /^(?:bull$|bullmq$|agenda$|node-cron$|@temporalio\/|inngest$|@trigger.dev\/)/,
  },
  {
    id: 'storage',
    title: 'Files & storage',
    icon: '▱',
    tokens: ['upload', 'uploads', 'storage', 'bucket', 'buckets', 's3', 'blob'],
    packages:
      /^(?:@aws-sdk\/client-s3$|@google-cloud\/storage$|@azure\/storage-blob$|multer$|@vercel\/blob$)/,
  },
  {
    id: 'email',
    title: 'Email & notifications',
    icon: '✉',
    tokens: ['email', 'mail', 'mailer', 'notification', 'notifications'],
    packages: /^(?:nodemailer$|resend$|@sendgrid\/|postmark$|mailgun.js$|@novu\/)/,
  },
  {
    id: 'security',
    title: 'Security & permissions',
    icon: '◇',
    tokens: [
      'security',
      'permission',
      'permissions',
      'rbac',
      'acl',
      'encryption',
      'crypto',
      'csrf',
    ],
    packages: /^(?:helmet$|bcrypt$|bcryptjs$|argon2$|csurf$|@casl\/|node:crypto$)/,
  },
  {
    id: 'ui',
    title: 'UI & application entry points',
    icon: '◈',
    tokens: ['app', 'pages', 'page', 'layout', 'components', 'renderer', 'main', 'bootstrap'],
    packages: /^(?:react$|vue$|svelte$|next$|nuxt$|@angular\/core$|electron$)/,
  },
  {
    id: 'tests',
    title: 'Tests',
    icon: '✓',
    tokens: ['test', 'tests', 'spec', 'specs', '__tests__', 'e2e'],
    packages: /^(?:vitest$|jest$|mocha$|@playwright\/test$|cypress$|node:test$)/,
  },
];

/** Naming and dependency signals, not a claim about runtime behavior or coverage. */
export function repositoryHighlights(
  analysis: Pick<AnalysisSummary, 'files' | 'techStack'>,
): RepositoryHighlight[] {
  const normalized = analysis.files
    .filter((file) => file.status === 'parsed')
    .map((file) => {
      const tokens = file.path
        .replaceAll('\\', '/')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

      return {
        file,
        tokens,
        test: tokens.some((token) =>
          ['test', 'tests', 'spec', 'specs', 'fixtures', 'mocks', 'e2e'].includes(token),
        ),
      };
    });

  return rules
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      icon: rule.icon,
      files: normalized
        .filter(
          ({ tokens, test }) =>
            (rule.id === 'tests' || !test) && tokens.some((token) => rule.tokens.includes(token)),
        )
        .map(({ file }) => ({ id: file.id, path: file.path }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      packages: (analysis.techStack?.packages ?? [])
        .filter((item) => rule.packages.test(item.name))
        .map((item) => ({ name: item.name, importedBy: item.importedBy })),
    }))
    .filter((item) => item.files.length || item.packages.length);
}
