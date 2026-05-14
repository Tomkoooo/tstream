import { ViewClient } from "./view-client";

export default async function ViewPage({ params }: { params: Promise<{ cameraSessionId: string }> }) {
  const { cameraSessionId } = await params;
  return <ViewClient cameraSessionId={cameraSessionId} />;
}
