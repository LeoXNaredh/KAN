import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAuthAdapter } from "./SupabaseAuthAdapter";

function createFakeAuthClient(overrides: Partial<SupabaseClient["auth"]>): SupabaseClient {
  return { auth: overrides } as unknown as SupabaseClient;
}

describe("SupabaseAuthAdapter", () => {
  it("registerWithPassword devuelve la identidad del usuario creado", async () => {
    const client = createFakeAuthClient({
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com" } }, error: null }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    const identity = await adapter.registerWithPassword({ email: "a@b.com", password: "secret123" });
    expect(identity).toEqual({ userId: "u1", email: "a@b.com" });
  });

  it("registerWithPassword lanza si Supabase devuelve error", async () => {
    const client = createFakeAuthClient({
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "email inválido" } }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    await expect(adapter.registerWithPassword({ email: "x", password: "y" })).rejects.toThrow("email inválido");
  });

  it("registerWithPassword lanza si no hay usuario ni error (caso inesperado)", async () => {
    const client = createFakeAuthClient({
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    await expect(adapter.registerWithPassword({ email: "x", password: "y" })).rejects.toThrow(
      /no devolvió un usuario/,
    );
  });

  it("signInWithPassword devuelve la identidad al autenticar correctamente", async () => {
    const client = createFakeAuthClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "u2", email: "c@d.com" } }, error: null }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    const identity = await adapter.signInWithPassword({ email: "c@d.com", password: "secret123" });
    expect(identity).toEqual({ userId: "u2", email: "c@d.com" });
  });

  it("signInWithPassword lanza con credenciales inválidas", async () => {
    const client = createFakeAuthClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "credenciales inválidas" } }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    await expect(adapter.signInWithPassword({ email: "x", password: "y" })).rejects.toThrow("credenciales inválidas");
  });

  it("sendMagicLink pasa el redirectTo cuando se provee", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = createFakeAuthClient({ signInWithOtp });
    const adapter = new SupabaseAuthAdapter(client);

    await adapter.sendMagicLink("a@b.com", "https://kan.app/auth/callback");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.com",
      options: { emailRedirectTo: "https://kan.app/auth/callback" },
    });
  });

  it("sendMagicLink funciona sin redirectTo", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = createFakeAuthClient({ signInWithOtp });
    const adapter = new SupabaseAuthAdapter(client);

    await adapter.sendMagicLink("a@b.com");
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "a@b.com", options: undefined });
  });

  it("signOut lanza si Supabase devuelve error", async () => {
    const client = createFakeAuthClient({
      signOut: vi.fn().mockResolvedValue({ error: { message: "no se pudo cerrar sesión" } }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    await expect(adapter.signOut()).rejects.toThrow("no se pudo cerrar sesión");
  });

  it("getCurrentUser devuelve la identidad cuando hay sesión", async () => {
    const client = createFakeAuthClient({
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u3", email: "e@f.com" } }, error: null }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    expect(await adapter.getCurrentUser()).toEqual({ userId: "u3", email: "e@f.com" });
  });

  it("getCurrentUser devuelve undefined sin sesión, sin lanzar", async () => {
    const client = createFakeAuthClient({
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "sin sesión" } }),
    });
    const adapter = new SupabaseAuthAdapter(client);

    expect(await adapter.getCurrentUser()).toBeUndefined();
  });

  it("getCurrentUser(accessToken) valida el JWT dado en vez de la sesión implícita del cliente (ADR-029)", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "u4", email: "movil@kan.dev" } }, error: null });
    const client = createFakeAuthClient({ getUser });
    const adapter = new SupabaseAuthAdapter(client);

    const identity = await adapter.getCurrentUser("un-jwt-de-la-app-movil");

    expect(identity).toEqual({ userId: "u4", email: "movil@kan.dev" });
    expect(getUser).toHaveBeenCalledWith("un-jwt-de-la-app-movil");
  });
});
