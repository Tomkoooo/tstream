import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteRoom, getRoomById, rotateRoomCode, updateRoomName } from "@/lib/room-service";
import { isRequestAuthed } from "@/lib/session";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rotateCode: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ roomId: string }> }) {
  if (!(await isRequestAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { roomId } = await ctx.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (parsed.data.rotateCode) {
    const room = await rotateRoomCode(roomId);
    if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ room });
  }
  if (parsed.data.name) {
    const room = await updateRoomName(roomId, parsed.data.name);
    if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ room });
  }
  return NextResponse.json({ error: "No changes" }, { status: 400 });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ roomId: string }> }) {
  if (!(await isRequestAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { roomId } = await ctx.params;
  const existing = await getRoomById(roomId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteRoom(roomId);
  return NextResponse.json({ ok: true });
}
