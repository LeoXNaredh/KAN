import type { SupabaseClient } from "@supabase/supabase-js";

export interface FakeQueryResult {
  data: unknown;
  error: unknown;
  count?: number;
}

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export type FakeTableResolver = FakeQueryResult | ((calls: RecordedCall[]) => FakeQueryResult);

/**
 * Fake del query builder fluido de supabase-js — es "thenable" (awaitable
 * directo, como hace `countRows`) y encadena `.select()/.eq()/.is()/.gt()/
 * .order()/.insert()/.update()/.upsert()` hasta `.single()`/`.maybeSingle()`
 * o hasta que se le hace `await` directo. Graba las llamadas encadenadas para que un
 * resolver dinámico pueda decidir la respuesta según qué se le pidió (ej.
 * distinguir un `select` de comprobación de un `insert` real sobre la misma
 * tabla dentro del mismo test).
 */
export class FakeQueryBuilder implements PromiseLike<FakeQueryResult> {
  private readonly calls: RecordedCall[] = [];

  constructor(private readonly resolver: FakeTableResolver) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]) {
    return this.record("select", args);
  }
  eq(...args: unknown[]) {
    return this.record("eq", args);
  }
  is(...args: unknown[]) {
    return this.record("is", args);
  }
  or(...args: unknown[]) {
    return this.record("or", args);
  }
  gt(...args: unknown[]) {
    return this.record("gt", args);
  }
  order(...args: unknown[]) {
    return this.record("order", args);
  }
  limit(...args: unknown[]) {
    return this.record("limit", args);
  }
  insert(...args: unknown[]) {
    return this.record("insert", args);
  }
  update(...args: unknown[]) {
    return this.record("update", args);
  }
  upsert(...args: unknown[]) {
    return this.record("upsert", args);
  }
  delete(...args: unknown[]) {
    return this.record("delete", args);
  }

  private resolve(): FakeQueryResult {
    return typeof this.resolver === "function" ? this.resolver(this.calls) : this.resolver;
  }

  single() {
    return Promise.resolve(this.resolve());
  }
  maybeSingle() {
    return Promise.resolve(this.resolve());
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

export function createFakeFromClient(responses: Record<string, FakeTableResolver>): SupabaseClient {
  return {
    from: (table: string) => new FakeQueryBuilder(responses[table]),
  } as unknown as SupabaseClient;
}
