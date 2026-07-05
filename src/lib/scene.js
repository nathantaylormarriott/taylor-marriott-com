import * as THREE from 'three';

const DEPTH = 720;
const SPREAD_X = 340;
const SPREAD_Y = 220;

export function createScene({ canvas, config, isMobile, reduced }) {
  const colorA = new THREE.Color(config.nebula.colorA);
  const colorB = new THREE.Color(config.nebula.colorB);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x050507, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
  camera.position.set(0, 0, 0);

  const target = { scroll: 0, focal: 0, fov: 60, px: 0, py: 0 };
  const current = { scroll: 0, focal: 0, fov: 60, px: 0, py: 0 };
  const nebulaTarget = {
    colorA: colorA.clone(),
    colorB: colorB.clone(),
    intensity: config.nebula.intensity,
  };
  const nebulaCurrent = {
    colorA: colorA.clone(),
    colorB: colorB.clone(),
    intensity: config.nebula.intensity,
  };

  const starCount = isMobile ? config.stars.mobile : config.stars.desktop;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const shades = new Float32Array(starCount);
  const phases = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    positions[i * 3 + 0] = (Math.random() * 2 - 1) * SPREAD_X;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * SPREAD_Y;
    positions[i * 3 + 2] = Math.random() * DEPTH;
    sizes[i] = Math.random() < 0.06 ? 1.8 + Math.random() * 1.6 : 0.5 + Math.random() * 1.2;
    shades[i] = Math.random();
    phases[i] = Math.random();
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  starGeo.setAttribute('aShade', new THREE.BufferAttribute(shades, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uDepth: { value: DEPTH },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uTintA: { value: colorA },
      uTintB: { value: colorB },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uScroll;
      uniform float uDepth;
      uniform float uPixelRatio;
      uniform vec3 uTintA;
      uniform vec3 uTintB;
      attribute float aSize;
      attribute float aShade;
      attribute float aPhase;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec3 pos = position;
        pos.z = mod(position.z + uScroll, uDepth) - uDepth;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        float dist = -mv.z;
        gl_PointSize = max(aSize * uPixelRatio * (320.0 / dist), 1.0);
        float twinkle = 0.78 + 0.22 * sin(uTime * 1.6 + aPhase * 6.2831);
        float farFade  = smoothstep(uDepth, uDepth - 180.0, dist);
        float nearFade = smoothstep(2.0, 60.0, dist);
        vAlpha = twinkle * farFade * nearFade;
        vec3 white = vec3(0.91, 0.93, 0.96);
        vec3 tint = mix(uTintA, uTintB, step(0.5, aShade));
        vColor = mix(white, tint, abs(aShade * 2.0 - 1.0) * 0.35);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.08, d) * 0.5 + smoothstep(0.16, 0.0, d);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  const nebulaMat = new THREE.ShaderMaterial({
    depthWrite: false,
    defines: { OCTAVES: isMobile ? 3 : 5 },
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
      uIntensity: { value: config.nebula.intensity },
      uNebulaRot: { value: isMobile ? 1.0 : 0.0 },
      uNebulaZoom: { value: isMobile ? 1.45 : 1.0 },
      uTransitionZoom: { value: 1.0 },
      uNebulaAnimFrozen: { value: 0.0 },
      uNebulaFrozenTimeOffset: { value: new THREE.Vector2() },
      uNebulaFrozenScrollOffset: { value: new THREE.Vector2() },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uScroll;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uIntensity;
      uniform float uNebulaRot;
      uniform float uNebulaZoom;
      uniform float uTransitionZoom;
      uniform float uNebulaAnimFrozen;
      uniform vec2 uNebulaFrozenTimeOffset;
      uniform vec2 uNebulaFrozenScrollOffset;
      float hash(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, amp = 0.5;
        for (int i = 0; i < OCTAVES; i++) {
          v += amp * noise(p);
          p *= 2.03;
          amp *= 0.5;
        }
        return v;
      }
      void main() {
        vec2 uv = vUv - 0.5;
        float rot = uNebulaRot * 1.57079632679;
        float c = cos(rot);
        float s = sin(rot);
        uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
        uv = uv / (uNebulaZoom * uTransitionZoom) + 0.5;
        vec2 timeOffset = uNebulaAnimFrozen > 0.5
          ? uNebulaFrozenTimeOffset
          : vec2(uTime * 0.012, uTime * -0.008);
        vec2 scrollOffset = uNebulaAnimFrozen > 0.5
          ? uNebulaFrozenScrollOffset
          : vec2(uScroll * 0.0008);
        vec2 p = uv * 3.0 + timeOffset + scrollOffset;
        float n1 = fbm(p);
        float n2 = fbm(p * 1.8 + n1 * 1.6 + vec2(4.7, 9.2));
        vec3 nebula = mix(uColorA, uColorB, smoothstep(0.3, 0.8, n2));
        float density = smoothstep(0.42, 0.95, (n1 + n2) * 0.55);
        float mask = smoothstep(1.25, 0.25, length(vUv - 0.5) * 2.0);
        vec3 col = vec3(0.02, 0.02, 0.028);
        col += vec3(0.106, 0.078, 0.22) * 0.5 * mask;
        col += nebula * density * mask * uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nebulaMat);
  nebula.position.z = -(DEPTH + 40);
  nebula.renderOrder = -1;
  scene.add(nebula);

  function fitNebula() {
    const dist = DEPTH + 40;
    const cover = isMobile ? 1.0 : 1.6;
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(60) / 2) * dist * cover;
    nebula.scale.set(h * camera.aspect, h, 1);
  }

  const focalMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uFocal: { value: 0 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uFocal;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      void main() {
        vec2 q = vUv - 0.5;
        float d = length(q) * 2.0;
        float pulse = 1.0 + 0.05 * sin(uTime * 1.4);
        float core = smoothstep(0.16 * pulse, 0.0, d);
        float halo = pow(max(0.0, 1.0 - d), 2.6);
        float spikeH = pow(max(0.0, 1.0 - abs(q.y) * 26.0), 3.0) * pow(max(0.0, 1.0 - d), 1.4);
        float spikeV = pow(max(0.0, 1.0 - abs(q.x) * 26.0), 3.0) * pow(max(0.0, 1.0 - d), 1.4) * 0.6;
        vec3 col = mix(uColorB, vec3(1.0), core);
        col += uColorA * halo * 0.45;
        float a = (core * 1.2 + halo * 0.8 + (spikeH + spikeV) * 0.5) * uFocal;
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const focal = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), focalMat);
  focal.position.set(0, 3, -300);
  focal.visible = false;
  scene.add(focal);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    starMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    fitNebula();
  }
  window.addEventListener('resize', resize);
  fitNebula();

  const lerp = (a, b, t) => a + (b - a) * t;

  const DRIFT_PX_AMP = 0.72;
  const DRIFT_PY_AMP = 0.18;
  const DRIFT_PX_FREQ = 0.14;
  const DRIFT_PY_FREQ = 0.095;

  function applyNebulaUniforms() {
    starMat.uniforms.uTintA.value.copy(nebulaCurrent.colorA);
    starMat.uniforms.uTintB.value.copy(nebulaCurrent.colorB);
    nebulaMat.uniforms.uColorA.value.copy(nebulaCurrent.colorA);
    nebulaMat.uniforms.uColorB.value.copy(nebulaCurrent.colorB);
    nebulaMat.uniforms.uIntensity.value = nebulaCurrent.intensity;
    focalMat.uniforms.uColorA.value.copy(nebulaCurrent.colorA);
    focalMat.uniforms.uColorB.value.copy(nebulaCurrent.colorB);
  }

  let viewLocked = false;
  const afterRenderHooks = [];

  function render(time) {
    current.scroll = lerp(current.scroll, target.scroll, 0.1);
    current.focal = lerp(current.focal, target.focal, 0.09);
    current.fov = lerp(current.fov, target.fov, 0.07);
    current.px = lerp(current.px, target.px, 0.045);
    current.py = lerp(current.py, target.py, 0.045);

    nebulaCurrent.colorA.lerp(nebulaTarget.colorA, 0.045);
    nebulaCurrent.colorB.lerp(nebulaTarget.colorB, 0.045);
    nebulaCurrent.intensity = lerp(nebulaCurrent.intensity, nebulaTarget.intensity, 0.045);
    applyNebulaUniforms();

    const t = reduced ? 0 : time;
    starMat.uniforms.uTime.value = t;
    starMat.uniforms.uScroll.value = current.scroll;
    nebulaMat.uniforms.uTime.value = t;
    nebulaMat.uniforms.uScroll.value = current.scroll;
    focalMat.uniforms.uTime.value = t;
    focalMat.uniforms.uFocal.value = current.focal;
    focal.visible = current.focal > 0.01;
    focal.scale.setScalar(0.55 + current.focal * 0.75);

    if (!reduced && !viewLocked) {
      const autoPx = Math.sin(t * DRIFT_PX_FREQ) * DRIFT_PX_AMP;
      const autoPy = Math.sin(t * DRIFT_PY_FREQ + 1.4) * DRIFT_PY_AMP;
      camera.position.x = (current.px + autoPx) * 6;
      camera.position.y = (current.py + autoPy) * -3.5;
    } else {
      camera.position.x = 0;
      camera.position.y = 0;
    }
    camera.lookAt(0, 0, -220);
    if (Math.abs(current.fov - camera.fov) > 0.01) {
      camera.fov = current.fov;
      camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);
    afterRenderHooks.forEach((fn) => fn());
  }

  return {
    render,
    onAfterRender(fn) {
      afterRenderHooks.push(fn);
      return () => {
        const index = afterRenderHooks.indexOf(fn);
        if (index >= 0) afterRenderHooks.splice(index, 1);
      };
    },
    setScroll: (v) => { target.scroll = v; },
    setScrollImmediate: (v) => {
      target.scroll = v;
      current.scroll = v;
      starMat.uniforms.uScroll.value = v;
      nebulaMat.uniforms.uScroll.value = v;
    },
    setFocal: (v) => { target.focal = v; },
    setFov: (v) => { target.fov = v; },
    resetCamera: () => {
      target.focal = 0;
      target.fov = 60;
      current.focal = 0;
      current.fov = 60;
      camera.fov = 60;
      camera.updateProjectionMatrix();
      focal.visible = false;
    },
    resetPointer: () => {
      target.px = 0;
      target.py = 0;
      current.px = 0;
      current.py = 0;
    },
    lockView: (locked) => { viewLocked = locked; },
    setNebulaTransitionZoom: (zoom) => {
      nebulaMat.uniforms.uTransitionZoom.value = zoom;
    },
    getNebulaTransitionZoom: () => nebulaMat.uniforms.uTransitionZoom.value,
    freezeNebulaAnim: () => {
      const t = nebulaMat.uniforms.uTime.value;
      const scroll = current.scroll;
      nebulaMat.uniforms.uNebulaFrozenTimeOffset.value.set(t * 0.012, t * -0.008);
      const scrollOffset = scroll * 0.0008;
      nebulaMat.uniforms.uNebulaFrozenScrollOffset.value.set(scrollOffset, scrollOffset);
      nebulaMat.uniforms.uNebulaAnimFrozen.value = 1;
    },
    setNebulaAnimFrozen: (frozen) => {
      nebulaMat.uniforms.uNebulaAnimFrozen.value = frozen ? 1 : 0;
    },
    resetNebulaTransition: () => {
      nebulaMat.uniforms.uTransitionZoom.value = 1;
      nebulaMat.uniforms.uNebulaAnimFrozen.value = 0;
      nebulaMat.uniforms.uNebulaFrozenTimeOffset.value.set(0, 0);
      nebulaMat.uniforms.uNebulaFrozenScrollOffset.value.set(0, 0);
    },
    getCamera: () => ({ focal: current.focal, fov: current.fov }),
    getScroll: () => current.scroll,
    setPointer: (x, y) => { target.px = x; target.py = y; },
    setNebula: ({ colorA, colorB, intensity }) => {
      if (colorA) nebulaTarget.colorA.set(colorA);
      if (colorB) nebulaTarget.colorB.set(colorB);
      if (intensity != null) nebulaTarget.intensity = intensity;
    },
    dispose: () => {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    }
  };
}