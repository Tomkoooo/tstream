import { Suspense } from "react";
import { CameraClient } from "./camera-client";

export default function CameraPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <CameraClient />
    </Suspense>
  );
}
