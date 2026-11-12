import { useEffect, useRef, useState } from "react";
import type { EngineState } from "../sim/protocol";
import { useApp } from "../store";

/**
 * Subscribes to engine telemetry at a reduced rate for React text readouts.
 * Canvas components should use useTelemetryRef + requestAnimationFrame instead.
 */
export function useTelemetry<T>(select: (s: EngineState) => T, hz = 12): T | null {
  const client = useApp((s) => s.client);
  const [value, setValue] = useState<T | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    if (!client) return;
    let last = 0;
    return client.subscribe((state) => {
      const now = performance.now();
      if (now - last < 1000 / hz) return;
      last = now;
      setValue(selectRef.current(state));
    });
  }, [client, hz]);

  return value;
}

/** Latest telemetry in a ref (no re-renders), for animation loops. */
export function useTelemetryRef() {
  const client = useApp((s) => s.client);
  const ref = useRef<EngineState | null>(null);
  useEffect(() => {
    if (!client) return;
    ref.current = client.latest;
    return client.subscribe((state) => {
      ref.current = state;
    });
  }, [client]);
  return ref;
}

/** Runs `draw` every animation frame while mounted. */
export function useAnimationFrame(draw: (time: number) => void) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      drawRef.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}
