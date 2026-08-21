import { DispositivoClient } from "@/components/dispositivo/DispositivoClient";

export default async function DispositivoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DispositivoClient deviceId={id} />;
}
