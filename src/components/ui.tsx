import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowLineDownIcon,
  ArrowsClockwiseIcon,
  ArrowUUpLeftIcon,
  BarbellIcon,
  CaretUpDownIcon,
  CarIcon,
  ChartLineIcon,
  CheckIcon,
  CompassIcon,
  CopyIcon,
  CpuIcon,
  CrosshairIcon,
  CubeIcon,
  CubeTransparentIcon,
  CylinderIcon,
  DiscIcon,
  DownloadSimpleIcon,
  DropIcon,
  EngineIcon,
  EqualizerIcon,
  FanIcon,
  FireIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  GasPumpIcon,
  GaugeIcon,
  GearSixIcon,
  HandIcon,
  HourglassIcon,
  KeyboardIcon,
  KeyIcon,
  LightningIcon,
  LockIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PathIcon,
  type Icon as PhosphorIcon,
  PlanetIcon,
  PlayIcon,
  PulseIcon,
  RulerIcon,
  ScalesIcon,
  SidebarSimpleIcon,
  SirenIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SpeedometerIcon,
  SquareHalfIcon,
  SquareIcon,
  StackIcon,
  StopIcon,
  TagIcon,
  ThermometerIcon,
  TimerIcon,
  TrashIcon,
  TrendUpIcon,
  UploadSimpleIcon,
  VideoCameraIcon,
  WaveformIcon,
  WaveSineIcon,
  WavesIcon,
  WindIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { fmt } from "../units";

// ---------------------------------------------------------------------------
// Icons (Phosphor)
// ---------------------------------------------------------------------------

const icons = {
  chevron: CaretUpDownIcon,
  updown: CaretUpDownIcon,
  search: MagnifyingGlassIcon,
  volume: SpeakerHighIcon,
  mute: SpeakerSlashIcon,
  keyboard: KeyboardIcon,
  sidebar: SidebarSimpleIcon,
  close: XIcon,
  rotate: ArrowsClockwiseIcon,
  check: CheckIcon,
  engine: EngineIcon,
  key: KeyIcon,
  starter: LightningIcon,
  clutch: DiscIcon,
  camera: VideoCameraIcon,
  iso: CubeIcon,
  front: SquareIcon,
  side: SquareHalfIcon,
  top: ArrowLineDownIcon,
  upload: UploadSimpleIcon,
  save: FloppyDiskIcon,
  download: DownloadSimpleIcon,
  reset: ArrowCounterClockwiseIcon,
  play: PlayIcon,
  stop: StopIcon,
  gauge: GaugeIcon,
  flame: FireIcon,
  waveform: WaveformIcon,
  wrench: WrenchIcon,
  sliders: SlidersHorizontalIcon,
  chart: ChartLineIcon,
  activity: PulseIcon,
  car: CarIcon,
  cylinder: CylinderIcon,
  boxes: CubeTransparentIcon,
  wind: WindIcon,
  droplet: DropIcon,
  thermometer: ThermometerIcon,
  timer: TimerIcon,
  copy: CopyIcon,
  trash: TrashIcon,
  fan: FanIcon,
  fuel: GasPumpIcon,
  waves: WavesIcon,
  sparkles: SparkleIcon,
  weight: BarbellIcon,
  ruler: RulerIcon,
  rotateCw: ArrowClockwiseIcon,
  tag: TagIcon,
  layers: StackIcon,
  undo: ArrowUUpLeftIcon,
  hand: HandIcon,
  cpu: CpuIcon,
  audioLines: EqualizerIcon,
  speaker: SpeakerHighIcon,
  trendingUp: TrendUpIcon,
  scale: ScalesIcon,
  settings: GearSixIcon,
  folder: FolderOpenIcon,
  lock: LockIcon,
  dumbbell: BarbellIcon,
  route: PathIcon,
  orbit: PlanetIcon,
  bolt: LightningIcon,
  hourglass: HourglassIcon,
  siren: SirenIcon,
  compass: CompassIcon,
  spline: WaveSineIcon,
  circleDot: DiscIcon,
  crosshair: CrosshairIcon,
  speedometer: SpeedometerIcon,
  wand: MagicWandIcon,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component size={size} weight="regular" aria-hidden />;
}

// ---------------------------------------------------------------------------
// Popover behaviour: close on outside click / Escape
// ---------------------------------------------------------------------------

export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

type RangeProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  big?: boolean;
  label?: string;
  id?: string;
  onChange: (value: number) => void;
};

/** Styled range input. `log` maps the position logarithmically. */
export function Range({ value, min, max, step, log, big, label, id, onChange }: RangeProps) {
  const toPos = (v: number) =>
    log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : v;
  const fromPos = (p: number) =>
    log ? Math.exp(Math.log(min) + p * (Math.log(max) - Math.log(min))) : p;
  const clamped = Math.min(max, Math.max(min, value));
  const fraction = log ? toPos(clamped) : (clamped - min) / (max - min || 1);
  return (
    <div
      className={`range ${big ? "big" : ""}`}
      style={{ "--fill": `${fraction * 100}%` } as CSSProperties}
    >
      <input
        id={id}
        aria-label={label}
        type="range"
        min={log ? 0 : min}
        max={log ? 1 : max}
        step={log ? 0.001 : (step ?? (max - min) / 100)}
        value={toPos(clamped)}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
      />
    </div>
  );
}

type SliderProps = Omit<RangeProps, "id" | "label"> & {
  label: string;
  icon?: IconName;
  unit?: string;
  decimals?: number;
  hint?: string;
};

export function Slider({ label, icon, unit, decimals = 0, hint, ...range }: SliderProps) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>
          {icon && <Icon name={icon} size={15} />}
          {label}
        </label>
        <output htmlFor={id}>
          {fmt(range.value, decimals)}
          {unit && <small> {unit}</small>}
        </output>
      </div>
      <Range {...range} id={id} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  kbd,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  kbd?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch-row"
      onClick={() => onChange(!checked)}
    >
      <span className="label">
        <span>
          {label} {kbd && <kbd>{kbd}</kbd>}
        </span>
        {description && <small>{description}</small>}
      </span>
      <span className="switch" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Segmented control with sliding thumb (equal-width segments)
// ---------------------------------------------------------------------------

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size,
  solid,
  className,
}: {
  value: T;
  options: [T, ReactNode][];
  onChange: (value: T) => void;
  label?: string;
  size?: "sm";
  solid?: boolean;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex(([v]) => v === value),
  );
  return (
    <div
      className={["segmented", size, solid && "solid", className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={label}
      style={{ "--n": options.length, "--i": index } as CSSProperties}
    >
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select: capsule trigger + glass listbox
// ---------------------------------------------------------------------------

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
};

export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label?: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];

  return (
    <div className="select" ref={ref}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span className="value">
          <span>{current?.label ?? "—"}</span>
        </span>
        <span className="chev">
          <Icon name="updown" size={16} />
        </span>
      </button>
      {open && (
        <div className="popover" role="listbox">
          {groups.map((group) => (
            <div key={group}>
              {group && <div className="option-group">{group}</div>}
              {options
                .filter((o) => (o.group ?? "") === group)
                .map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    className="option"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <span className="text">
                      <span>{o.label}</span>
                      {o.description && <small>{o.description}</small>}
                    </span>
                    <span className="tick">
                      <Icon name="check" size={16} />
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A titled group inside a panel. Separated by spacing and a hairline. */
export function Section({
  title,
  icon,
  children,
  actions,
}: {
  title: string;
  icon?: IconName;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="group">
      <header className="group-head">
        <h3>
          {icon && (
            <span className="group-icon">
              <Icon name={icon} size={15} />
            </span>
          )}
          {title}
        </h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function NumberField({
  label,
  value,
  unit,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="input">
      <label htmlFor={id}>{label}</label>
      <div className="input-box">
        <input
          id={id}
          type="number"
          value={Number.isFinite(value) ? Number(value.toFixed(2)) : ""}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) onChange(v);
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="input" style={{ marginBottom: 16 }}>
      <label htmlFor={id}>{label}</label>
      <div className="input-box">
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

/** Single-choice list (radio rows with title + description). */
export function ChoiceList<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; title: string; description?: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="choice-list" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="choice"
          onClick={() => onChange(o.value)}
        >
          <span className="text">
            <b>{o.title}</b>
            {o.description && <small>{o.description}</small>}
          </span>
          <span className="radio" />
        </button>
      ))}
    </div>
  );
}

/** Gear selector: circular gears on a capsule with a sliding circular thumb. */
export function GearSelector({
  value,
  gears,
  onChange,
}: {
  value: number;
  gears: number;
  onChange: (gear: number) => void;
}) {
  const options = Array.from({ length: gears + 1 }, (_, i) => i - 1);
  const index = Math.max(0, options.indexOf(value));
  return (
    <div
      className="gearbox"
      role="radiogroup"
      aria-label="Marcha"
      style={{ "--i": index } as CSSProperties}
    >
      {options.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={g === value}
          aria-label={g < 0 ? "Neutro" : `Marcha ${g + 1}`}
          onClick={() => onChange(g)}
        >
          {g < 0 ? "N" : g + 1}
        </button>
      ))}
    </div>
  );
}
