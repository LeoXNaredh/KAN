import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const response = await gatewayFetch(`/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      return NextResponse.json({ error: `El Gateway respondió ${response.status} al cancelar el job.` }, { status: 502 });
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "No se pudo contactar al Gateway. ¿Está corriendo?" }, { status: 502 });
  }
}
