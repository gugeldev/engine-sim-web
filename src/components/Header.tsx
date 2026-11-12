import { useEffect, useMemo, useRef, useState } from "react";
import { KEY_HELP } from "../hooks/useKeyboard";
import { catalog } from "../mr/catalog";
import type { Quality } from "../sim/protocol";
import type { EngineSpec } from "../sim/spec";
import { useApp } from "../store";
import { fmt } from "../units";
import type { ViewPreset } from "./Engine3D";
import { Icon, type IconName, Range, Segmented, SwitchRow, usePopover } from "./ui";

/** Short architecture code shown in the picker badge: I4, V8, B4, R9… */
function layoutCode(spec: EngineSpec): string {
  const cylinders = spec.banks.reduce((n, b) => n + b.cylinders.length, 0);
  if (spec.banks.length === 1) return cylinders === 1 ? "1" : `I${cylinders}`;
  if (spec.banks.length > 2) return `R${cylinders}`;
  const spread = Math.abs(spec.banks[0].angleDeg - spec.banks[1].angleDeg);
  return `${spread >= 170 ? "B" : "V"}${cylinders}`;
}

type Entry = { id: string; name: string; description: string; group: string };

/** Engine selector in command-palette style: search, groups, keyboard nav. */
function EnginePicker() {
  const sourceId = useApp((s) => s.sourceId);
  const spec = useApp((s) => s.spec);
  const info = useApp((s) => s.info);
  const savedEngines = useApp((s) => s.savedEngines);
  const selectSource = useApp((s) => s.selectSource);
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      ...savedEngines.map((e) => ({
        id: e.id,
        name: e.name,
        description: "Salvo por você",
        group: "Meus motores",
      })),
      ...catalog.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        group: e.group,
      })),
    ];
    const q = query.trim().toLowerCase();
    return q
      ? list.filter((e) => `${e.name} ${e.description} ${e.group}`.toLowerCase().includes(q))
      : list;
  }, [savedEngines, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // "/" or Ctrl+K opens the picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const choose = (id: string) => {
    setOpen(false);
    if (id !== sourceId) void selectSource(id);
  };

  const groups = [...new Set(entries.map((e) => e.group))];
  let index = -1;

  return (
    <div className="anchor" ref={ref}>
      <button
        type="button"
        className="engine-trigger glass"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="engine-glyph" aria-hidden>
          {layoutCode(spec)}
        </span>
        <span className="label">
          <span className="name">{spec.name}</span>
          <span className="meta">
            {info
              ? `${info.cylinders} cilindros · ${fmt(info.displacementCc / 1000, 1)} L`
              : "Trocar motor"}
          </span>
        </span>
        <span className="chev">
          <Icon name="updown" size={16} />
        </span>
      </button>
      {open && (
        <div className="popover palette">
          <div className="search">
            <Icon name="search" size={16} />
            <input
              ref={inputRef}
              placeholder="Buscar motor"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(entries.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && entries[active]) {
                  choose(entries[active].id);
                }
                if (e.key !== "Escape") e.stopPropagation();
              }}
            />
            <kbd>esc</kbd>
          </div>
          <div className="palette-list" role="listbox">
            {entries.length === 0 && <div className="palette-empty">Nenhum motor encontrado</div>}
            {groups.map((group) => (
              <div key={group}>
                <div className="palette-group">{group}</div>
                {entries
                  .filter((e) => e.group === group)
                  .map((e) => {
                    index++;
                    const i = index;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        role="option"
                        aria-selected={e.id === sourceId}
                        data-active={i === active}
                        className="palette-item"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(e.id)}
                      >
                        <span className="text">
                          <span className="title">{e.name}</span>
                          <span className="desc">{e.description}</span>
                        </span>
                        <span className="tick">
                          <Icon name="check" size={16} />
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const QUALITY: [Quality, string][] = [
  ["auto", "Auto"],
  ["high", "Alta"],
  ["medium", "Média"],
  ["low", "Baixa"],
];

function AudioMenu() {
  const { open, setOpen, ref } = usePopover();
  const masterVolume = useApp((s) => s.masterVolume);
  const setMasterVolume = useApp((s) => s.setMasterVolume);
  const quality = useApp((s) => s.quality);
  const setQuality = useApp((s) => s.setQuality);
  const speed = useApp((s) => s.controls.simulationSpeed);
  const setControls = useApp((s) => s.setControls);

  return (
    <div className="anchor" ref={ref}>
      <button
        type="button"
        className="round"
        aria-label="Som e desempenho"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={masterVolume === 0 ? "mute" : "volume"} />
      </button>
      {open && (
        <div className="popover menu">
          <div className="group">
            <h4>Volume</h4>
            <Range
              label="Volume geral"
              value={masterVolume}
              min={0}
              max={1}
              step={0.01}
              onChange={setMasterVolume}
            />
          </div>
          <div className="group">
            <h4>Qualidade da simulação</h4>
            <Segmented size="sm" value={quality} options={QUALITY} onChange={setQuality} />
            <p className="hint">Auto reduz a precisão se o computador não acompanhar.</p>
          </div>
          <div className="group">
            <h4>Câmera lenta</h4>
            <Segmented
              size="sm"
              value={speed}
              options={[
                [1, "1×"],
                [0.1, "1/10"],
                [0.01, "1/100"],
                [0.001, "1/1000"],
              ]}
              onChange={(simulationSpeed) => setControls({ simulationSpeed })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function KeysMenu() {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="anchor" ref={ref}>
      <button
        type="button"
        className="round"
        aria-label="Atalhos de teclado"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="keyboard" />
      </button>
      {open && (
        <div className="popover menu">
          <h4>Atalhos de teclado</h4>
          <table className="keys">
            <tbody>
              {KEY_HELP.map(([key, what]) => (
                <tr key={key}>
                  <td>
                    <kbd>{key}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const VIEWS: [ViewPreset, string, IconName][] = [
  ["iso", "Perspectiva", "iso"],
  ["front", "Frente", "front"],
  ["side", "Lateral", "side"],
  ["top", "De cima", "top"],
];

function CameraMenu({
  view,
  onView,
  autoRotate,
  onAutoRotate,
}: {
  view: ViewPreset;
  onView: (view: ViewPreset) => void;
  autoRotate: boolean;
  onAutoRotate: (on: boolean) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="anchor" ref={ref}>
      <button
        type="button"
        className="round"
        aria-label="Câmera"
        title="Câmera"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="camera" />
      </button>
      {open && (
        <div className="popover menu" role="menu">
          <h4>Câmera</h4>
          {VIEWS.map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={v === view}
              className="option"
              onClick={() => onView(v)}
            >
              <Icon name={icon} size={16} />
              <span className="text">{label}</span>
              <span className="tick">
                <Icon name="check" size={16} />
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <SwitchRow label="Girar sozinho" checked={autoRotate} onChange={onAutoRotate} />
          <p className="hint">Arraste para girar · role para aproximar</p>
        </div>
      )}
    </div>
  );
}

export function Header({
  sheetOpen,
  onToggleSheet,
  view,
  onView,
  autoRotate,
  onAutoRotate,
}: {
  sheetOpen: boolean;
  onToggleSheet: () => void;
  view: ViewPreset;
  onView: (view: ViewPreset) => void;
  autoRotate: boolean;
  onAutoRotate: (on: boolean) => void;
}) {
  return (
    <header className="topbar">
      <EnginePicker />
      <div className="topbar-spacer" />
      <div className="bar glass">
        <CameraMenu
          view={view}
          onView={onView}
          autoRotate={autoRotate}
          onAutoRotate={onAutoRotate}
        />
        <AudioMenu />
        <KeysMenu />
        <span className="bar-sep" />
        <button
          type="button"
          className="round"
          aria-label={sheetOpen ? "Esconder painel" : "Mostrar painel"}
          aria-pressed={sheetOpen}
          onClick={onToggleSheet}
        >
          <Icon name="sidebar" />
        </button>
      </div>
    </header>
  );
}
