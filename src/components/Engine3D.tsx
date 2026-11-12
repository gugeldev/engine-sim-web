import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useTelemetryRef } from "../hooks/useTelemetry";
import { CYLINDER_STRIDE, Cyl, type EngineGeometry, type EngineState } from "../sim/protocol";
import { useApp } from "../store";

/**
 * 3D engine view. The simulation is planar (engine cross-section in x/y);
 * cylinders of the same bank are spread along z (the crank axis), which is
 * how a real engine is laid out and keeps inline engines readable.
 */

export type ViewPreset = "iso" | "front" | "side" | "top";

type CylinderRig = {
  bank: number;
  dir: THREE.Vector2;
  z: number;
  deck: number;
  half: number;
  wristPin: number;
  compressionHeight: number;
  bigEnd: number;
  littleEnd: number;
  slave: boolean;
  piston: THREE.Mesh;
  pin: THREE.Mesh;
  gas: THREE.Mesh;
  gasMat: THREE.MeshStandardMaterial;
  rod: THREE.Mesh;
  bigEndMesh: THREE.Mesh;
  crankPin: THREE.Mesh;
  webs: THREE.Mesh[];
  valves: { mesh: THREE.Group; kind: "intake" | "exhaust" }[];
};

type Rig = {
  root: THREE.Group;
  cylinders: CylinderRig[];
  flywheel: THREE.Group;
  center: THREE.Vector3;
  radius: number;
};

const COLORS = {
  metal: 0xd4d4d8,
  metalDark: 0x71717a,
  block: 0x27272a,
  head: 0x52525b,
  liner: 0xa1a1aa,
  valve: 0xe4e4e7,
  gas: 0x18181b,
  fire: 0xf5a524,
};

function makeMaterials() {
  return {
    metal: new THREE.MeshStandardMaterial({
      color: COLORS.metal,
      metalness: 0.85,
      roughness: 0.32,
    }),
    metalDark: new THREE.MeshStandardMaterial({
      color: COLORS.metalDark,
      metalness: 0.8,
      roughness: 0.4,
    }),
    head: new THREE.MeshStandardMaterial({
      color: COLORS.head,
      metalness: 0.5,
      roughness: 0.45,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    block: new THREE.MeshStandardMaterial({ color: COLORS.block, metalness: 0.3, roughness: 0.7 }),
    liner: new THREE.MeshStandardMaterial({
      color: COLORS.liner,
      metalness: 0.2,
      roughness: 0.2,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    linerEdge: new THREE.LineBasicMaterial({ color: 0x52525b, transparent: true, opacity: 0.6 }),
    valve: new THREE.MeshStandardMaterial({ color: COLORS.valve, metalness: 0.9, roughness: 0.25 }),
  };
}

/** Points the +Y axis of `mesh` from a to b and stretches it to the distance. */
function spanY(mesh: THREE.Object3D, ax: number, ay: number, bx: number, by: number, z: number) {
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, z);
  mesh.rotation.set(0, 0, Math.atan2(by - ay, bx - ax) - Math.PI / 2);
  mesh.scale.y = Math.max(1e-4, Math.hypot(bx - ax, by - ay));
}

function buildRig(geometry: EngineGeometry): Rig {
  const mats = makeMaterials();
  const root = new THREE.Group();
  const banks = geometry.banks;
  const maxBore = Math.max(...banks.map((b) => b.bore));
  const crank = geometry.crankshafts[0] ?? { x: 0, y: 0, throw: 0.04 };
  const throwR = crank.throw;
  const pitch = maxBore * 1.3;

  const perBank = banks.map((_, b) => geometry.cylinders.filter((c) => c.bank === b).length);
  const radial = banks.length > 2 && perBank.every((n) => n === 1);
  const maxPerBank = Math.max(...perBank);
  const zOf = (bank: number, index: number) => {
    if (radial) return 0;
    const bankOffset = banks.length === 2 ? (bank === 0 ? -1 : 1) * pitch * 0.18 : 0;
    return (index - (maxPerBank - 1) / 2) * pitch + bankOffset;
  };
  const zMin = zOf(0, 0) - pitch * 0.6;
  const zMax = zOf(banks.length - 1, maxPerBank - 1) + pitch * 0.6;

  // Main shaft
  const shaftGeo = new THREE.CylinderGeometry(throwR * 0.42, throwR * 0.42, 1, 32);
  const shaft = new THREE.Mesh(shaftGeo, mats.metalDark);
  shaft.rotation.x = Math.PI / 2;
  shaft.scale.y = zMax - zMin + pitch * 0.6;
  shaft.position.set(crank.x, crank.y, (zMin + zMax) / 2);
  root.add(shaft);

  // Flywheel at the back with an index mark so rotation is visible
  const flywheel = new THREE.Group();
  const fwDisk = new THREE.Mesh(
    new THREE.CylinderGeometry(throwR * 3.2, throwR * 3.2, maxBore * 0.16, 64),
    mats.metal,
  );
  fwDisk.rotation.x = Math.PI / 2;
  flywheel.add(fwDisk);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(throwR * 3.2, maxBore * 0.05, 12, 64),
    mats.metalDark,
  );
  flywheel.add(ring);
  for (let k = 0; k < 6; k++) {
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(throwR * 0.38, throwR * 0.38, maxBore * 0.18, 20),
      mats.block,
    );
    const a = (k / 6) * Math.PI * 2;
    hole.rotation.x = Math.PI / 2;
    hole.position.set(Math.cos(a) * throwR * 2, Math.sin(a) * throwR * 2, 0.0005);
    flywheel.add(hole);
  }
  const mark = new THREE.Mesh(
    new THREE.BoxGeometry(throwR * 0.3, throwR * 1.0, maxBore * 0.2),
    mats.valve,
  );
  mark.position.set(0, throwR * 2.75, 0);
  flywheel.add(mark);
  flywheel.position.set(crank.x, crank.y, zMin - pitch * 0.35);
  root.add(flywheel);

  // Shared geometries (unit-sized, scaled per instance)
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 40, 1, false);
  const unitCylOpen = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const cylinders: CylinderRig[] = geometry.cylinders.map((c) => {
    const bank = banks[c.bank];
    const dir = new THREE.Vector2(
      Math.cos(bank.angle + Math.PI / 2),
      Math.sin(bank.angle + Math.PI / 2),
    );
    const half = bank.bore / 2;
    const z = zOf(c.bank, c.index);
    const bottom = Math.max(throwR * 1.9, bank.deckHeight * 0.42);

    // Liner (glassy) + rim lines
    const liner = new THREE.Mesh(unitCylOpen, mats.liner);
    liner.scale.set(half * 1.04, 1, half * 1.04);
    spanY(
      liner,
      bank.x + dir.x * bottom,
      bank.y + dir.y * bottom,
      bank.x + dir.x * bank.deckHeight,
      bank.y + dir.y * bank.deckHeight,
      z,
    );
    root.add(liner);
    for (const at of [bottom, bank.deckHeight]) {
      const rim = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 49 }, (_, k) => {
            const a = (k / 48) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(a) * half * 1.04, 0, Math.sin(a) * half * 1.04);
          }),
        ),
        mats.linerEdge,
      );
      rim.position.set(bank.x + dir.x * at, bank.y + dir.y * at, z);
      rim.rotation.z = bank.angle;
      root.add(rim);
    }

    // Head (one block per cylinder; reads as a continuous head when adjacent)
    const headH = bank.bore * 0.45;
    const head = new THREE.Mesh(unitBox, mats.head);
    head.scale.set(bank.bore * 1.22, headH, radial ? bank.bore * 1.15 : pitch * 0.96);
    const hc = bank.deckHeight + headH / 2;
    head.position.set(bank.x + dir.x * hc, bank.y + dir.y * hc, z);
    head.rotation.z = bank.angle;
    root.add(head);

    // Valves sit side by side along z so both are visible
    const valves: CylinderRig["valves"] = [];
    for (const kind of ["intake", "exhaust"] as const) {
      const g = new THREE.Group();
      const headDisc = new THREE.Mesh(unitCyl, mats.valve);
      headDisc.scale.set(half * 0.32, half * 0.06, half * 0.32);
      g.add(headDisc);
      const stem = new THREE.Mesh(unitCyl, mats.valve);
      stem.scale.set(half * 0.05, headH * 0.9, half * 0.05);
      stem.position.y = headH * 0.45;
      g.add(stem);
      g.rotation.z = bank.angle;
      g.userData.offset = (kind === "intake" ? -1 : 1) * half * 0.42 * (bank.flip ? -1 : 1);
      root.add(g);
      valves.push({ mesh: g, kind });
    }

    // Combustion gas column
    const gasMat = new THREE.MeshStandardMaterial({
      color: COLORS.gas,
      emissive: new THREE.Color(COLORS.fire),
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.85,
      roughness: 1,
    });
    const gas = new THREE.Mesh(unitCyl, gasMat);
    gas.scale.set(half * 0.97, 1, half * 0.97);
    root.add(gas);

    // Piston
    const skirt = c.compressionHeight * 1.7;
    const piston = new THREE.Mesh(unitCyl, mats.metal);
    piston.scale.set(half * 0.97, skirt, half * 0.97);
    piston.rotation.z = bank.angle;
    root.add(piston);
    const pin = new THREE.Mesh(unitCyl, mats.metalDark);
    pin.scale.set(half * 0.18, bank.bore * 0.9, half * 0.18);
    pin.rotation.x = Math.PI / 2;
    root.add(pin);

    // Connecting rod
    const rod = new THREE.Mesh(unitBox, mats.metal);
    rod.scale.set(bank.bore * 0.16, 1, bank.bore * 0.12);
    root.add(rod);
    const bigEndMesh = new THREE.Mesh(unitCyl, mats.metal);
    bigEndMesh.scale.set(throwR * 0.55, bank.bore * 0.2, throwR * 0.55);
    bigEndMesh.rotation.x = Math.PI / 2;
    root.add(bigEndMesh);

    // Crank pin + two webs (skipped for slave rods riding on a master rod)
    const crankPin = new THREE.Mesh(unitCyl, mats.metalDark);
    crankPin.scale.set(throwR * 0.36, radial ? bank.bore * 0.3 : pitch * 0.42, throwR * 0.36);
    crankPin.rotation.x = Math.PI / 2;
    crankPin.visible = !c.slave;
    root.add(crankPin);
    const webs: THREE.Mesh[] = [];
    if (!c.slave) {
      for (const side of [-1, 1]) {
        const web = new THREE.Mesh(unitBox, mats.metalDark);
        web.scale.set(throwR * 1.05, 1, bank.bore * 0.09);
        web.userData.dz = side * (radial ? bank.bore * 0.2 : pitch * 0.26);
        root.add(web);
        webs.push(web);
      }
    }

    return {
      bank: c.bank,
      dir,
      z,
      deck: bank.deckHeight,
      half,
      wristPin: c.wristPin,
      compressionHeight: c.compressionHeight,
      bigEnd: c.bigEnd,
      littleEnd: c.littleEnd,
      slave: c.slave,
      piston,
      pin,
      gas,
      gasMat,
      rod,
      bigEndMesh,
      crankPin,
      webs,
      valves,
    };
  });

  // Bounding sphere for camera framing
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return { root, cylinders, flywheel, center: sphere.center, radius: sphere.radius };
}

const rot = (theta: number, x: number, y: number): [number, number] => [
  x * Math.cos(theta) - y * Math.sin(theta),
  x * Math.sin(theta) + y * Math.cos(theta),
];

function updateRig(rig: Rig, geometry: EngineGeometry, state: EngineState | null) {
  const crank = geometry.crankshafts[0];
  const cyl = state?.cylinders;
  if (state && crank) rig.flywheel.rotation.z = state.crankAngles[0] ?? 0;

  // Until the first telemetry arrives, moving parts have no pose yet.
  rig.root.visible = cyl !== undefined && cyl.length > 0;

  rig.cylinders.forEach((c, i) => {
    const bank = geometry.banks[c.bank];
    const k = i * CYLINDER_STRIDE;
    const px = cyl ? cyl[k + Cyl.pistonX] : bank.x + c.dir.x * c.deck * 0.6;
    const py = cyl ? cyl[k + Cyl.pistonY] : bank.y + c.dir.y * c.deck * 0.6;
    const [ox, oy] = rot(bank.angle + Math.PI, 0, c.wristPin);
    const pinX = px + ox;
    const pinY = py + oy;
    const crownX = pinX + c.dir.x * c.compressionHeight;
    const crownY = pinY + c.dir.y * c.compressionHeight;
    const skirt = c.compressionHeight * 1.7;

    c.piston.position.set(crownX - (c.dir.x * skirt) / 2, crownY - (c.dir.y * skirt) / 2, c.z);
    c.pin.position.set(pinX, pinY, c.z);

    const deckX = bank.x + c.dir.x * c.deck;
    const deckY = bank.y + c.dir.y * c.deck;
    spanY(c.gas, crownX, crownY, deckX, deckY, c.z);

    if (cyl) {
      const temperature = cyl[k + Cyl.temperature];
      const lit = cyl[k + Cyl.lit] > 0.5;
      const heat = Math.min(1, Math.max(0, (temperature - 900) / 1500));
      c.gasMat.emissiveIntensity = heat * 2.2 + (lit ? 1.2 : 0);
      c.gasMat.opacity = 0.25 + heat * 0.7;

      const rx = cyl[k + Cyl.rodX];
      const ry = cyl[k + Cyl.rodY];
      const rt = cyl[k + Cyl.rodTheta];
      const [bx, by] = rot(rt, 0, c.bigEnd);
      const [lx, ly] = rot(rt, 0, c.littleEnd);
      spanY(c.rod, rx + bx, ry + by, rx + lx, ry + ly, c.z);
      c.bigEndMesh.position.set(rx + bx, ry + by, c.z);
      c.crankPin.position.set(rx + bx, ry + by, c.z);

      if (crank) {
        for (const web of c.webs) {
          // Web spans from slightly behind the main journal to the crank pin.
          const ex = rx + bx;
          const ey = ry + by;
          const back = 0.45;
          spanY(
            web,
            crank.x - (ex - crank.x) * back,
            crank.y - (ey - crank.y) * back,
            ex,
            ey,
            c.z + web.userData.dz,
          );
        }
      }

      for (const v of c.valves) {
        const lift = cyl[k + (v.kind === "intake" ? Cyl.intakeLift : Cyl.exhaustLift)];
        const open = Math.min(lift * 2.5, c.half * 0.6);
        const along = c.deck - open - c.half * 0.03;
        v.mesh.position.set(
          bank.x + c.dir.x * along,
          bank.y + c.dir.y * along,
          c.z + v.mesh.userData.offset,
        );
      }
    }
  });
}

const PRESETS: Record<ViewPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(0.95, 0.55, 1.35),
  front: new THREE.Vector3(0, 0.08, 1),
  side: new THREE.Vector3(1, 0.15, 0.02),
  top: new THREE.Vector3(0.01, 1, 0.25),
};

export type Insets = { top: number; right: number; bottom: number; left: number };

export function Engine3D({
  view,
  autoRotate,
  insets,
}: {
  view: ViewPreset;
  autoRotate: boolean;
  insets: Insets;
}) {
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const hostRef = useRef<HTMLDivElement>(null);
  const geometry = useApp((s) => s.geometry);
  const state = useTelemetryRef();
  const resizeRef = useRef<(() => void) | null>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    rig: Rig | null;
    goal: THREE.Vector3 | null;
  } | null>(null);

  // Renderer / scene lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-3, 1, -2);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.autoRotateSpeed = 0.6;

    ctx.current = { renderer, scene, camera, controls, rig: null, goal: null };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      // Center the engine in the area not covered by floating panels.
      const i = insetsRef.current;
      const narrow = w < 860;
      const dx = narrow ? 0 : (i.left - i.right) / 2;
      const dy = narrow ? 0 : (i.top - i.bottom) / 2;
      camera.setViewOffset(w, h, -dx, -dy, w, h);
      camera.updateProjectionMatrix();
    };
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const loop = () => {
      const c = ctx.current;
      if (c) {
        const geo = useApp.getState().geometry;
        if (c.rig && geo) updateRig(c.rig, geo, state.current);
        if (c.goal) {
          // Smoothly fly to a preset camera position.
          c.camera.position.lerp(c.goal, 0.12);
          if (c.camera.position.distanceTo(c.goal) < c.goal.length() * 0.002) c.goal = null;
        }
        c.controls.update();
        c.renderer.render(c.scene, c.camera);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctx.current = null;
    };
  }, [state]);

  // Rebuild the rig when the engine changes
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.rig) {
      c.scene.remove(c.rig.root);
      c.rig.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      c.rig = null;
    }
    if (!geometry) return;
    const rig = buildRig(geometry);
    c.scene.add(rig.root);
    c.rig = rig;
    c.controls.target.copy(rig.center);
    c.controls.minDistance = rig.radius * 1.2;
    c.controls.maxDistance = rig.radius * 8;
    // Fit the bounding sphere into the free area between the panels.
    const host = hostRef.current;
    const i = insetsRef.current;
    const w = host?.clientWidth ?? 1;
    const h = host?.clientHeight ?? 1;
    const narrow = w < 860;
    const free = narrow ? 1 : Math.min((w - i.left - i.right) / w, (h - i.top - i.bottom) / h);
    const halfFov = THREE.MathUtils.degToRad(c.camera.fov / 2);
    const distance = (rig.radius / Math.sin(halfFov) / Math.max(0.45, free)) * 0.52;
    c.camera.position
      .copy(rig.center)
      .add(PRESETS.iso.clone().normalize().multiplyScalar(distance));
    c.goal = null;
    c.controls.update();
  }, [geometry]);

  // Re-center when panels open/close
  useEffect(() => {
    resizeRef.current?.();
  }, [insets.left, insets.right, insets.top, insets.bottom]);

  // Camera presets
  useEffect(() => {
    const c = ctx.current;
    if (!c?.rig) return;
    const distance = c.camera.position.distanceTo(c.controls.target);
    c.goal = c.rig.center.clone().add(PRESETS[view].clone().normalize().multiplyScalar(distance));
  }, [view]);

  useEffect(() => {
    if (ctx.current) ctx.current.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  return (
    <div
      ref={hostRef}
      className="stage"
      aria-label="Motor em 3D: arraste para girar, role para aproximar"
    />
  );
}
