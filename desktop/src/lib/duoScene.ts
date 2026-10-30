import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// The iPhone Duo for the peek hint, in scene units: one half (and the cover
// screen) is 466 × 678 pt, so 0.687 × 1. Each half is a slab hinged on its
// edge at x = 0; the back half lies at x 0…W with its inner screen facing the
// camera, and the front half turns about the hinge, its outer face being the
// cover screen.
const W = 0.687;
const H = 1;
const T = 0.03;
const OUTER = 0.13;
const HINGE = 0.025;
const BEZEL = 0.02;
/** How far the front half opens at the peek, in degrees between the halves. */
const PEEK = 112;
const LOOP = 4.4;

export interface DuoChat {
  name: string;
}

/** A rounded rectangle with its hinge side (x = 0) less rounded. `side` is
 *  which way it extends from the hinge. */
function slab(side: 1 | -1, inset: number) {
  const w = W - 2 * inset;
  const h = H - 2 * inset;
  const outer = Math.max(OUTER - inset, 0.01);
  const hinge = Math.max(HINGE - inset / 2, 0.005);
  const x0 = side === 1 ? inset : -W + inset;
  const y0 = -h / 2;
  // Corners: hinge side gets `hinge`, the far side gets `outer`.
  const [rl, rr] = side === 1 ? [hinge, outer] : [outer, hinge];
  const s = new THREE.Shape();
  s.moveTo(x0 + rl, y0);
  s.lineTo(x0 + w - rr, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr);
  s.lineTo(x0 + w, y0 + h - rr);
  s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
  s.lineTo(x0 + rl, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rl);
  s.lineTo(x0, y0 + rl);
  s.quadraticCurveTo(x0, y0, x0 + rl, y0);
  return s;
}

/** A flat screen whose texture spans its own bounds. */
function screenGeometry(shape: THREE.Shape) {
  const g = new THREE.ShapeGeometry(shape, 24);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - b.min.x) / (b.max.x - b.min.x), (pos.getY(i) - b.min.y) / (b.max.y - b.min.y));
  }
  return g;
}

const FONT = '-apple-system, "SF Pro Text", "Thonburi", sans-serif';
const CW = 480;
const CH = Math.round((CW * (H - 2 * BEZEL)) / (W - 2 * BEZEL));

function canvas() {
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = CH;
  return [c, c.getContext("2d")!] as const;
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, w, h, h / 2);
  g.fill();
}

function eye(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = size * 0.16;
  g.beginPath();
  g.ellipse(x, y, size, size * 0.6, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(x, y, size * 0.28, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.restore();
}

function avatar(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, letter?: string) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  if (letter) {
    g.fillStyle = "#fff";
    g.font = `600 ${Math.round(r * 1.05)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(letter, x, y + r * 0.06);
  }
}

function fitText(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

const GREEN = "#06C755";

/** LAAB's chat list on the cover screen, the picked chat marked. */
function drawCover(chat: DuoChat) {
  const [c, g] = canvas();
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, CW, CH);
  const bar = 62;
  const left = 26;
  const right = CW - bar - 10;
  g.fillStyle = "#111";
  g.font = `700 40px ${FONT}`;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillText("แชท", left, 78);
  pill(g, left, 100, right - left, 40, "#efeff2");
  const rows = ["#F4C430", "#5B8DEF", "#E6A8C8", "#7CC4A4", "#A7D08C", "#9A8CF0", "#F09A6B"];
  let y = 168;
  rows.forEach((color, i) => {
    const picked = i === 1;
    if (picked) {
      g.fillStyle = "rgba(6,199,85,0.12)";
      g.beginPath();
      g.roundRect(left - 12, y - 8, right - left + 24, 82, 16);
      g.fill();
    }
    avatar(g, left + 30, y + 33, 30, color, picked ? [...chat.name][0] : undefined);
    if (picked) {
      eye(g, left + 84, y + 22, 11, GREEN);
      g.fillStyle = "#111";
      g.font = `600 26px ${FONT}`;
      g.fillText(fitText(g, chat.name, right - left - 110), left + 102, y + 31);
      pill(g, left + 76, y + 46, 150, 10, "#c8c8cf");
    } else {
      pill(g, left + 76, y + 16, 120 + ((i * 37) % 60), 11, "#3a3a3c");
      pill(g, left + 76, y + 42, 180 + ((i * 53) % 70), 10, "#d0d0d6");
    }
    if (i % 3 === 0) avatar(g, right - 14, y + 44, 13, GREEN);
    y += 90;
  });
  // The vertical bar: camera, clock, and a glass capsule of tabs.
  const bx = CW - bar / 2 - 6;
  g.fillStyle = "#000";
  g.beginPath();
  g.arc(bx, 40, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111";
  g.font = `600 17px ${FONT}`;
  g.textAlign = "center";
  g.fillText("9:41", bx, 86);
  pill(g, bx - 24, CH - 290, 48, 250, "#f1f1f4");
  [0, 1, 2, 3].forEach((i) => avatar(g, bx, CH - 260 + i * 62, i === 1 ? 14 : 11, i === 1 ? "#1c1c1e" : "#8e8e93"));
  return c;
}

/** The inner screen's left half: who the chat is with. */
function drawInnerLeft(chat: DuoChat) {
  const [c, g] = canvas();
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, CW, CH);
  avatar(g, CW / 2, CH / 2 - 70, 62, "#5B8DEF", [...chat.name][0]);
  g.fillStyle = "#111";
  g.font = `700 34px ${FONT}`;
  g.textAlign = "center";
  g.fillText(fitText(g, chat.name, CW - 60), CW / 2, CH / 2 + 40);
  eye(g, CW / 2 - 128, CH / 2 + 84, 13, "#6b6b70");
  g.fillStyle = "#6b6b70";
  g.font = `500 24px ${FONT}`;
  g.fillText("ยังไม่ขึ้นว่าอ่านแล้ว", CW / 2 + 12, CH / 2 + 92);
  return c;
}

/** The inner screen's right half: the messages. */
function drawInnerRight() {
  const [c, g] = canvas();
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, CW, CH);
  const bubbles: [number, boolean][] = [
    [250, false],
    [170, false],
    [210, true],
    [290, false],
    [140, true],
    [230, false],
    [190, true],
  ];
  let y = 70;
  bubbles.forEach(([w, mine]) => {
    const x = mine ? CW - 30 - w : 70;
    if (!mine) avatar(g, 40, y + 22, 18, "#5B8DEF");
    g.fillStyle = mine ? "#7ed98a" : "#e2e2e8";
    g.beginPath();
    g.roundRect(x, y, w, 46, 22);
    g.fill();
    // A line of text in the bubble.
    pill(g, x + 18, y + 18, w - 36 - ((w * 7) % 40), 10, mine ? "#3f9a4b" : "#9a9aa2");
    y += 80;
  });
  return c;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 0 closed … 1 at the peek, over one loop: hold shut, open, hold, shut. */
function opening(t: number) {
  const s = (t % LOOP) / LOOP;
  if (s < 0.14) return 0;
  if (s < 0.42) return ease((s - 0.14) / 0.28);
  if (s < 0.74) return 1;
  if (s < 0.94) return 1 - ease((s - 0.74) / 0.2);
  return 0;
}

/** Draw the iPhone Duo into `el` and animate it until the returned function
 *  is called. Throws when WebGL is unavailable. */
export function mountDuo(el: HTMLElement, chat: DuoChat, still: boolean) {
  const width = el.clientWidth;
  const height = el.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Hidden until its shaders are compiled, which takes a moment the first
  // time (about a second in the simulator), so the card never shows a gap.
  const view = renderer.domElement;
  view.style.opacity = "0";
  view.style.transition = "opacity 300ms ease-out";
  el.appendChild(view);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();

  const camera = new THREE.PerspectiveCamera(26, width / height, 0.1, 50);
  camera.position.set(0.12, 0.46, 3.05);
  camera.lookAt(0, -0.02, 0);

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-1.6, 2.4, 2.8);
  scene.add(key);
  // A rim light from behind picks the frame's edges out of a dark card.
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(2.2, 1.2, -2.4);
  scene.add(rim);

  const device = new THREE.Group();
  scene.add(device);

  const frame = new THREE.MeshPhysicalMaterial({
    color: 0x3a3a40,
    metalness: 0.85,
    roughness: 0.28,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  });
  const body = (side: 1 | -1) => {
    const g = new THREE.ExtrudeGeometry(slab(side, 0.006), {
      depth: T - 0.012,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 5,
      curveSegments: 28,
    });
    g.translate(0, 0, -T + 0.006);
    return new THREE.Mesh(g, frame);
  };
  const textures: THREE.CanvasTexture[] = [];
  const screen = (c: HTMLCanvasElement, side: 1 | -1) => {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.push(tex);
    // A lit screen shows its own colours, untouched by the scene's light.
    const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const mesh = new THREE.Mesh(screenGeometry(slab(side, BEZEL)), m);
    // The cover glass: only its reflections, added over the screen.
    const glass = new THREE.Mesh(
      new THREE.ShapeGeometry(slab(side, 0.008), 24),
      new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        roughness: 0.04,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        envMapIntensity: 0.2,
      }),
    );
    glass.position.z = 0.0015;
    mesh.add(glass);
    return mesh;
  };
  const black = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, clearcoat: 1 });
  const glassFace = (side: 1 | -1) => new THREE.Mesh(new THREE.ShapeGeometry(slab(side, 0.008), 24), black);

  // The back half: frame, black glass, the inner screen's right side.
  const back = new THREE.Group();
  back.add(body(1));
  const backGlass = glassFace(1);
  backGlass.position.z = 0.0005;
  back.add(backGlass);
  const innerRight = screen(drawInnerRight(), 1);
  innerRight.position.z = 0.001;
  back.add(innerRight);
  device.add(back);

  // The front half, turning on the hinge: the inner screen's left side on
  // one face, the cover screen on the other.
  const front = new THREE.Group();
  front.add(body(-1));
  const frontGlass = glassFace(-1);
  frontGlass.position.z = 0.0005;
  front.add(frontGlass);
  const innerLeft = screen(drawInnerLeft(chat), -1);
  innerLeft.position.z = 0.001;
  front.add(innerLeft);
  // The cover screen is drawn as a right-hand slab and turned over, so it
  // reads the right way round once the half is shut, hinge on its left.
  const coverGlass = glassFace(1);
  coverGlass.rotation.y = Math.PI;
  coverGlass.position.z = -T - 0.0005;
  front.add(coverGlass);
  const cover = screen(drawCover(chat), 1);
  cover.rotation.y = Math.PI;
  cover.position.z = -T - 0.001;
  front.add(cover);
  device.add(front);

  // The spine: half a cylinder on the outside of the fold.
  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry(T, T, H - 2 * HINGE, 32, 1, true, Math.PI / 2, Math.PI),
    frame,
  );
  device.add(spine);

  // A soft contact shadow under the device.
  const sc = document.createElement("canvas");
  sc.width = sc.height = 128;
  const sg = sc.getContext("2d")!;
  const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(sc);
  textures.push(shadowTex);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -H / 2 - 0.06;
  scene.add(shadow);

  const innerScreens = [innerLeft, innerRight].map((m) => m.material as THREE.MeshBasicMaterial);

  const pose = (p: number, t: number) => {
    // Degrees between the halves: 0 shut, PEEK at the peek.
    const open = p * PEEK;
    const turn = THREE.MathUtils.degToRad(180 - open);
    front.rotation.y = turn;
    spine.rotation.y = turn / 2;
    // Keep the device centred as it opens (the front half reaches `span`
    // left of the hinge), and let it sway a little.
    const span = W * Math.max(0, Math.cos(turn));
    device.position.x = -(W - span) / 2;
    device.rotation.y = -0.38 + p * 0.22 + Math.sin(t * 0.9) * 0.025;
    device.rotation.x = 0.08;
    device.position.y = Math.sin(t * 1.3) * 0.008;
    shadow.scale.set((W + span) * 1.25, 0.5, 1);
    // The inner screen comes on as it opens.
    const light = THREE.MathUtils.smoothstep(p, 0.25, 0.85);
    for (const m of innerScreens) m.color.setScalar(0.03 + 0.97 * light);
  };

  let frameId = 0;
  let stopped = false;
  let start = 0;
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    pose(still ? 1 : opening(t), still ? 0 : t);
    renderer.render(scene, camera);
    if (!still && !stopped) frameId = requestAnimationFrame(tick);
  };
  renderer
    .compileAsync(scene, camera)
    .catch(() => {})
    .then(() => {
      if (stopped) return;
      start = performance.now();
      tick();
      view.style.opacity = "1";
    });

  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
    textures.forEach((x) => x.dispose());
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
