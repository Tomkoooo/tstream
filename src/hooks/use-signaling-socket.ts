"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const SOCKET_PATH = "/socket.io";

export function useSignalingSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = io({
      path: SOCKET_PATH,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 15_000,
      withCredentials: true,
    });
    socketRef.current = s;
    const tid = window.setTimeout(() => {
      setSocket(s);
      setConnected(s.connected);
    }, 0);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    return () => {
      window.clearTimeout(tid);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.close();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, []);

  return { socket, connected, socketRef };
}
