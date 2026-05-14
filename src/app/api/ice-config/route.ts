import { NextResponse } from "next/server";
import { isRequestAuthed } from "@/lib/session";
import { getServerIceServers } from "@/lib/ice-servers";

export async function GET() {
  if (!(await isRequestAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ iceServers: getServerIceServers() });
}
