"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildMemoryUseCases } from "./composition";

export async function addMemoryAction(formData: FormData) {
  const category = String(formData.get("category") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  if (category && key && value) {
    const { setMemory } = await buildMemoryUseCases();
    await setMemory.execute(user.userId, category, key, value);
  }
  redirect("/configuracion");
}

export async function removeMemoryAction(formData: FormData) {
  const category = String(formData.get("category") ?? "");
  const key = String(formData.get("key") ?? "");

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  const { removeMemory } = await buildMemoryUseCases();
  await removeMemory.execute(user.userId, category, key);
  redirect("/configuracion");
}
