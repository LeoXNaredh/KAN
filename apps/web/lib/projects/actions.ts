"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildProjectsUseCases } from "./composition";

export async function createProjectAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  if (name) {
    const { createProject } = await buildProjectsUseCases();
    await createProject.execute(user.userId, name, description || undefined);
  }
  redirect("/proyectos");
}

export async function removeProjectAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  const { removeProject } = await buildProjectsUseCases();
  await removeProject.execute(user.userId, id);
  redirect("/proyectos");
}
