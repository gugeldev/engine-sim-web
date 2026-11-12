import { useEffect, useRef, useState } from "react";
import { specFromMr } from "../mr/catalog";
import { get, set } from "../sim/edit";
import type { EngineSpec, HarmonicLobe } from "../sim/spec";
import { useApp } from "../store";
import { fmt } from "../units";
import { Icon, NumberField, Section, Slider } from "./ui";

/**
 * Engine editor. Edits a draft copy of the spec; "Aplicar" rebuilds the engine
 * (physics changes can't be hot-swapped). Shift offsets for cams/ignition are
 * kept relative to the draft's starting point so the sliders stay intuitive.
 */
export function EnginePanel() {
  const spec = useApp((s) => s.spec);
  const sourceId = useApp((s) => s.sourceId);
  const loadSpec = useApp((s) => s.loadSpec);
  const saveEngine = useApp((s) => s.saveEngine);
  const deleteSaved = useApp((s) => s.deleteSavedEngine);
  const isSaved = sourceId.startsWith("saved:");

  const [draft, setDraft] = useState<EngineSpec>(spec);
  const [shifts, setShifts] = useState({ intake: 0, exhaust: 0, timing: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the draft whenever a different engine is loaded.
  useEffect(() => {
    setDraft(spec);
    setShifts({ intake: 0, exhaust: 0, timing: 0 });
  }, [spec]);

  const dirty = draft !== spec;
  const update = (fn: (s: EngineSpec) => EngineSpec) => setDraft((d) => fn(d));

  const intakeCam = get.cam(draft, "intakeCam");
  const exhaustCam = get.cam(draft, "exhaustCam");
  const harmonic = intakeCam.lobe.type === "harmonic" && exhaustCam.lobe.type === "harmonic";
  const intakeLobe = intakeCam.lobe as HarmonicLobe;
  const exhaustLobe = exhaustCam.lobe as HarmonicLobe;
  const intake = draft.intakes[0];

  const apply = () => {
    void loadSpec(draft, sourceId);
    setMessage(null);
  };

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  return (
    <div className="panel">
      <div className="actions">
        <button type="button" className="pill primary" disabled={!dirty} onClick={apply}>
          <Icon name="check" size={16} />
          {dirty ? "Aplicar e reiniciar o motor" : "Nenhuma alteração"}
        </button>
        {dirty && (
          <button type="button" className="pill" onClick={() => setDraft(spec)}>
            <Icon name="undo" size={16} />
            Desfazer alterações
          </button>
        )}
      </div>

      <Section title="Identidade" icon="tag">
        <div className="input">
          <label htmlFor="engine-name">Nome</label>
          <div className="input-box">
            <input
              id="engine-name"
              type="text"
              value={draft.name}
              onChange={(e) => {
                const name = e.target.value;
                update((s) => ({ ...s, name }));
              }}
            />
          </div>
        </div>
        <p className="hint">
          {get.cylinders(draft)} cilindros · {fmt(get.displacementCc(draft) / 1000, 2)} litros
        </p>
      </Section>

      <Section title="Cilindros e pistões" icon="cylinder">
        <div className="grid-2">
          <NumberField
            label="Diâmetro do cilindro"
            unit="mm"
            step={0.5}
            value={get.bore(draft)}
            onChange={(v) => update((s) => set.bore(s, v))}
          />
          <NumberField
            label="Curso do pistão"
            unit="mm"
            step={0.5}
            value={get.stroke(draft)}
            onChange={(v) => update((s) => set.stroke(s, v))}
          />
          <NumberField
            label="Comprimento da biela"
            unit="mm"
            step={1}
            value={get.rodLength(draft)}
            onChange={(v) => update((s) => set.rodLength(s, v))}
          />
          <NumberField
            label="Taxa de compressão"
            unit=":1"
            step={0.1}
            value={Number(get.compressionRatio(draft).toFixed(2))}
            onChange={(v) => update((s) => set.compressionRatio(s, v))}
          />
        </div>
      </Section>

      <Section title="Rotação e ignição" icon="gauge">
        <Slider
          icon="siren"
          label="Corte de giro (limitador)"
          value={draft.ignition.revLimitRpm}
          min={1500}
          max={16000}
          step={100}
          unit="rpm"
          onChange={(v) =>
            update((s) => ({
              ...s,
              redlineRpm: Math.min(s.redlineRpm, v),
              ignition: { ...s.ignition, revLimitRpm: v },
            }))
          }
        />
        <Slider
          icon="gauge"
          label="Início da faixa vermelha"
          value={draft.redlineRpm}
          min={1000}
          max={16000}
          step={100}
          unit="rpm"
          onChange={(v) => update((s) => ({ ...s, redlineRpm: v }))}
        />
        <Slider
          icon="timer"
          label="Duração de cada corte"
          value={draft.ignition.limiterDurationS * 1000}
          min={10}
          max={1000}
          step={10}
          unit="ms"
          onChange={(v) =>
            update((s) => ({ ...s, ignition: { ...s.ignition, limiterDurationS: v / 1000 } }))
          }
        />
        <Slider
          icon="flame"
          label="Adiantar/atrasar a faísca"
          value={shifts.timing}
          min={-20}
          max={20}
          step={1}
          unit="°"
          onChange={(v) => {
            const delta = v - shifts.timing;
            setShifts((x) => ({ ...x, timing: v }));
            update((s) => set.timingOffset(s, delta));
          }}
        />
      </Section>

      <Section title="Comando de válvulas" icon="orbit">
        {harmonic ? (
          <>
            <div className="grid-2">
              <NumberField
                label="Duração admissão"
                unit="°"
                value={intakeLobe.durationAt50ThouDeg}
                onChange={(v) =>
                  update((s) => set.cam(s, "intakeCam", { lobe: { durationAt50ThouDeg: v } }))
                }
              />
              <NumberField
                label="Duração escape"
                unit="°"
                value={exhaustLobe.durationAt50ThouDeg}
                onChange={(v) =>
                  update((s) => set.cam(s, "exhaustCam", { lobe: { durationAt50ThouDeg: v } }))
                }
              />
              <NumberField
                label="Levante admissão"
                unit="mm"
                step={0.1}
                value={intakeLobe.liftMm}
                onChange={(v) => update((s) => set.cam(s, "intakeCam", { lobe: { liftMm: v } }))}
              />
              <NumberField
                label="Levante escape"
                unit="mm"
                step={0.1}
                value={exhaustLobe.liftMm}
                onChange={(v) => update((s) => set.cam(s, "exhaustCam", { lobe: { liftMm: v } }))}
              />
            </div>
            <Slider
              icon="rotateCw"
              label="Adiantar/atrasar admissão"
              value={shifts.intake}
              min={-30}
              max={30}
              unit="°"
              onChange={(v) => {
                const delta = v - shifts.intake;
                setShifts((x) => ({ ...x, intake: v }));
                update((s) => set.camCenterDelta(s, "intakeCam", delta));
              }}
            />
            <Slider
              icon="rotateCw"
              label="Adiantar/atrasar escape"
              value={shifts.exhaust}
              min={-30}
              max={30}
              unit="°"
              onChange={(v) => {
                const delta = v - shifts.exhaust;
                setShifts((x) => ({ ...x, exhaust: v }));
                update((s) => set.camCenterDelta(s, "exhaustCam", delta));
              }}
            />
          </>
        ) : (
          <p className="hint">Este motor usa perfis de came amostrados; edite pelo JSON.</p>
        )}
      </Section>

      <Section title="Admissão de ar" icon="wind">
        <Slider
          icon="fan"
          label="Tamanho da borboleta (vazão)"
          value={intake.intakeFlowCfm}
          min={50}
          max={3000}
          step={10}
          unit="cfm"
          onChange={(v) => update((s) => set.intake(s, { intakeFlowCfm: v }))}
        />
        <Slider
          icon="route"
          label="Vazão dos dutos de admissão"
          value={intake.runnerFlowCfm}
          min={20}
          max={1500}
          step={5}
          unit="cfm"
          onChange={(v) => update((s) => set.intake(s, { runnerFlowCfm: v }))}
        />
        <Slider
          icon="hourglass"
          label="Rotação da marcha lenta"
          value={(1 - intake.idleThrottlePlatePosition) * 1000}
          min={0}
          max={60}
          step={0.5}
          decimals={1}
          unit="‰"
          onChange={(v) =>
            update((s) => set.intake(s, { idleThrottlePlatePosition: 1 - v / 1000 }))
          }
        />
      </Section>

      <Section title="Inércia e atrito" icon="dumbbell">
        <Slider
          icon="weight"
          label="Peso do volante (inércia)"
          value={draft.crankshafts[0].momentOfInertia}
          min={0.005}
          max={2}
          log
          decimals={3}
          unit="kg·m²"
          onChange={(v) => update((s) => set.inertiaScale(s, v / s.crankshafts[0].momentOfInertia))}
        />
        <Slider
          icon="hand"
          label="Atrito interno"
          value={draft.crankshafts[0].frictionTorqueNm}
          min={0}
          max={150}
          step={1}
          unit="N·m"
          onChange={(v) =>
            update((s) => ({
              ...s,
              crankshafts: s.crankshafts.map((c) => ({ ...c, frictionTorqueNm: v })),
            }))
          }
        />
        <Slider
          icon="fuel"
          label="Eficiência da combustão"
          value={(draft.fuel.maxBurningEfficiency ?? 0.8) * 100}
          min={30}
          max={100}
          unit="%"
          onChange={(v) =>
            update((s) => ({ ...s, fuel: { ...s.fuel, maxBurningEfficiency: v / 100 } }))
          }
        />
      </Section>

      <Section title="Veículo e câmbio" icon="car">
        <div className="grid-2">
          <NumberField
            label="Peso do carro"
            unit="kg"
            step={10}
            value={draft.vehicle.massKg}
            onChange={(v) => update((s) => ({ ...s, vehicle: { ...s.vehicle, massKg: v } }))}
          />
          <NumberField
            label="Relação do diferencial"
            unit=":1"
            step={0.01}
            value={draft.vehicle.diffRatio}
            onChange={(v) => update((s) => ({ ...s, vehicle: { ...s.vehicle, diffRatio: v } }))}
          />
          <NumberField
            label="Raio do pneu"
            unit="mm"
            step={1}
            value={draft.vehicle.tireRadiusMm}
            onChange={(v) => update((s) => ({ ...s, vehicle: { ...s.vehicle, tireRadiusMm: v } }))}
          />
          <div className="input">
            <label htmlFor="gears">Relações das marchas</label>
            <div className="input-box">
              <input
                id="gears"
                defaultValue={draft.transmission.gears.join("  ")}
                key={draft.transmission.gears.join(",")}
                onBlur={(e) => {
                  const gears = e.target.value
                    .split(/[\s;]+/)
                    .map((x) => Number(x.replace(",", ".")))
                    .filter((x) => Number.isFinite(x) && x > 0);
                  if (gears.length)
                    update((s) => ({ ...s, transmission: { ...s.transmission, gears } }));
                }}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Salvar e compartilhar" icon="save">
        <div className="row">
          <button
            type="button"
            className="pill"
            onClick={() => {
              saveEngine(draft);
              if (dirty) void loadSpec(draft, useApp.getState().sourceId);
              flash("Salvo em “Meus motores”.");
            }}
          >
            <Icon name="save" size={16} />
            {isSaved ? "Salvar alterações" : "Salvar em Meus motores"}
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${draft.name.replace(/[^\w-]+/g, "_") || "motor"}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Icon name="download" size={16} />
            Baixar arquivo do motor (.json)
          </button>
          <button type="button" className="pill" onClick={() => fileRef.current?.click()}>
            <Icon name="folder" size={16} />
            Abrir motor (.json ou .mr)
          </button>
          {isSaved && (
            <button
              type="button"
              className="pill danger"
              onClick={() => {
                deleteSaved(sourceId);
                void useApp.getState().selectSource("gm-ls");
              }}
            >
              <Icon name="trash" size={16} />
              Excluir dos meus motores
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.mr,application/json"
          multiple
          hidden
          onChange={async (e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            const file = list[0];
            if (!file) return;
            try {
              let imported: EngineSpec;
              const mrFiles = list.filter((f) => f.name.endsWith(".mr"));
              if (mrFiles.length) {
                // Extra .mr files (e.g. a shared radial.mr) can be imported by the first one.
                const extra: Record<string, string> = {};
                for (const f of mrFiles) extra[`user/${f.name}`] = await f.text();
                imported = specFromMr(`user/${mrFiles[0].name}`, extra);
              } else {
                imported = JSON.parse(await file.text()) as EngineSpec;
              }
              if (!imported.banks || !imported.crankshafts)
                throw new Error("arquivo não parece um motor");
              setDraft(imported);
              void loadSpec(imported, `import:${file.name}`);
              flash("Motor importado. Salve para mantê-lo.");
            } catch (error) {
              flash(`Erro: ${error instanceof Error ? error.message : String(error)}`);
            }
          }}
        />
        {message && <p className="hint">{message}</p>}
      </Section>
    </div>
  );
}
