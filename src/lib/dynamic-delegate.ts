/**
 * Typed shape for the "look up a Prisma model by its string name" pattern.
 *
 * Several code paths (soft-delete, recovery, user-merge) operate over a
 * registry of model names like `"project"` and `"client"`. The Prisma
 * client doesn't expose a typed string-keyed accessor for this, so the
 * old code reached for `(db as any)[name]`. That triggers
 * `@typescript-eslint/no-explicit-any` and obscures what the call site
 * actually expects of the delegate.
 *
 * `DynamicPrismaDelegate` declares only the methods these workers use,
 * with their args / return shapes narrowed to the columns we actually
 * read or write. Callers cast through `unknown`:
 *
 *     const delegate = (db as unknown as Record<string, DynamicPrismaDelegate>)[name];
 *
 * which is type-safe at the call site without re-deriving Prisma's full
 * generic delegate machinery for a dynamic key.
 */

export type DelegateRow = { id: string; deletedAt?: Date | null } & Record<string, unknown>;

export interface DynamicPrismaDelegate {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<DelegateRow | null>;

  findMany(args: {
    where?: Record<string, unknown>;
    select?: Record<string, boolean>;
    orderBy?: Record<string, unknown>;
  }): Promise<DelegateRow[]>;

  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<DelegateRow | null>;

  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
    select?: Record<string, boolean>;
  }): Promise<DelegateRow>;

  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;

  delete(args: {
    where: { id: string };
  }): Promise<DelegateRow>;

  deleteMany(args: {
    where: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export type DynamicDelegateMap = Record<string, DynamicPrismaDelegate>;
