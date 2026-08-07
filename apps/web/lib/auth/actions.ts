"use server";

import { redirect } from "next/navigation";
import { buildAuthUseCases } from "./composition";

export async function signOutAction() {
  const { signOut } = await buildAuthUseCases();
  await signOut.execute();
  redirect("/login");
}

export async function updateDisplayNameAction(formData: FormData) {
  const displayName = String(formData.get("displayName") ?? "").trim();

  const { getCurrentUser, updateDisplayName } = await buildAuthUseCases();
  const user = await getCurrentUser.execute();
  if (!user) redirect("/login");

  if (displayName) {
    await updateDisplayName.execute(user.userId, displayName);
  }
  redirect("/configuracion?updated=1");
}
