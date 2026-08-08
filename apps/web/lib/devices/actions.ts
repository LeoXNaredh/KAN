"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildDeviceUseCases } from "./composition";

export async function generatePairingCodeAction() {
  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  const { generatePairingCode } = await buildDeviceUseCases();
  const { code, expiresAt } = await generatePairingCode.execute(user.userId);
  redirect(`/dispositivos?code=${encodeURIComponent(code)}&expiresAt=${encodeURIComponent(expiresAt)}`);
}
