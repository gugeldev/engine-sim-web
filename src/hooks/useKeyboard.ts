import { useEffect } from "react";
import { useApp } from "../store";

/** Keyboard layout inspired by the original engine-sim. */
export const KEY_HELP: [string, string][] = [
  ["A", "Liga/desliga ignição"],
  ["S (segurar)", "Motor de partida"],
  ["Q / W / E / R", "Acelerador 1% / 10% / 20% / 100% (enquanto segura)"],
  ["Espaço + roda", "Ajuste fino do acelerador (trava)"],
  ["↑ / ↓", "Sobe / desce marcha"],
  ["Shift (segurar)", "Embreagem"],
  ["D", "Liga/desliga dinamômetro"],
  ["H", "Dinamômetro: segurar rotação"],
  ["1 … 5", "Câmera lenta (segurar)"],
];

const HOLD_THROTTLE: Record<string, number> = { KeyQ: 0.01, KeyW: 0.1, KeyE: 0.2, KeyR: 1 };
const SLOW_MOTION: Record<string, number> = {
  Digit1: 1 / 10,
  Digit2: 1 / 100,
  Digit3: 1 / 200,
  Digit4: 1 / 500,
  Digit5: 1 / 1000,
};

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
  }
  return false;
}

export function useKeyboard() {
  useEffect(() => {
    const held = new Set<string>();
    /** Throttle the user set with the mouse/slider; restored when a hold key is released. */
    let baseThrottle: number | null = null;
    let spaceHeld = false;

    const { getState } = useApp;

    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const app = getState();
      if (app.status !== "running") return;
      if (e.code === "Space") {
        spaceHeld = true;
        e.preventDefault();
        return;
      }
      if (held.has(e.code)) return;
      held.add(e.code);

      const c = app.controls;
      if (e.code in HOLD_THROTTLE) {
        baseThrottle ??= c.throttle;
        app.setControls({ throttle: HOLD_THROTTLE[e.code] });
      } else if (e.code in SLOW_MOTION) {
        app.setControls({ simulationSpeed: SLOW_MOTION[e.code] });
      } else {
        switch (e.code) {
          case "KeyA":
            app.setControls({ ignition: !c.ignition });
            break;
          case "KeyS":
            app.setControls({ starter: true });
            break;
          case "ArrowUp":
            e.preventDefault();
            app.setControls({ gear: Math.min(c.gear + 1, (app.info?.gears ?? 1) - 1) });
            break;
          case "ArrowDown":
            e.preventDefault();
            app.setControls({ gear: Math.max(c.gear - 1, -1) });
            break;
          case "ShiftLeft":
          case "ShiftRight":
            app.setControls({ clutch: 0 });
            break;
          case "KeyD":
            app.setControls({ dyno: { enabled: !c.dyno.enabled } });
            break;
          case "KeyH":
            app.setControls({ dyno: { hold: !c.dyno.hold } });
            break;
        }
      }
    };

    const onUp = (e: KeyboardEvent) => {
      held.delete(e.code);
      const app = getState();
      if (e.code === "Space") spaceHeld = false;
      if (e.code in HOLD_THROTTLE) {
        const stillHeld = Object.keys(HOLD_THROTTLE).find((k) => held.has(k));
        if (stillHeld) app.setControls({ throttle: HOLD_THROTTLE[stillHeld] });
        else {
          app.setControls({ throttle: baseThrottle ?? 0 });
          baseThrottle = null;
        }
      } else if (e.code in SLOW_MOTION) {
        if (!Object.keys(SLOW_MOTION).some((k) => held.has(k)))
          app.setControls({ simulationSpeed: 1 });
      } else if (e.code === "KeyS") {
        app.setControls({ starter: false });
      } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        app.setControls({ clutch: 1 });
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!spaceHeld) return;
      const app = getState();
      e.preventDefault();
      const next = Math.min(1, Math.max(0, app.controls.throttle - Math.sign(e.deltaY) * 0.01));
      app.setControls({ throttle: next });
    };

    const onBlur = () => {
      // Releasing focus must not leave the starter cranking or throttle pinned.
      const app = getState();
      if (held.has("KeyS")) app.setControls({ starter: false });
      if (baseThrottle !== null) app.setControls({ throttle: baseThrottle });
      if (held.has("ShiftLeft") || held.has("ShiftRight")) app.setControls({ clutch: 1 });
      held.clear();
      baseThrottle = null;
      spaceHeld = false;
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
