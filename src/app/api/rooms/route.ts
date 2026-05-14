import { NextResponse } from "next/server";
import { z } from "zod";
import { createRoom, listRooms } from "@/lib/room-service";
import { isRequestAuthed } from "@/lib/session";

export async function GET() {
  if (!(await isRequestAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rooms = await listRooms();
  return NextResponse.json({ rooms });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  if (!(await isRequestAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const room = await createRoom(parsed.data.name);
  return NextResponse.json({ room });
}
