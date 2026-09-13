// Paste into nebula ShaderMaterial fragmentShader after fbm().
// Requires existing: hash, noise, fbm, uColorA, uColorB, uIntensity, uPillarMode,
// uNebulaRot, uNebulaZoom, uIdleZoom, uTransitionZoom, timeOffset, scrollOffset, mask.

uniform float uPillarMode;

float ridged(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    float n = noise(p);
    n = 1.0 - abs(n * 2.0 - 1.0);
    v += n * n * amp;
    p *= 2.04;
    amp *= 0.5;
  }
  return v;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float organicPillar(vec2 uv, vec2 a, vec2 b, float wBase, float wTop, float bulb, float seed) {
  vec2 warp = vec2(
    fbm(uv * 6.5 + seed) - 0.5,
    fbm(uv * 5.2 + seed + 4.1) - 0.5
  ) * 0.055;
  vec2 p = uv + warp;
  float t = clamp((p.y - a.y) / max(b.y - a.y, 0.001), 0.0, 1.0);
  float width = mix(wBase, wTop, pow(t, 0.72));
  width += bulb * smoothstep(0.62, 0.92, t) * (1.0 - smoothstep(0.92, 1.02, t));
  float d = sdSegment(p, a, b) - width;
  float ridge = ridged(p * vec2(9.0, 4.2) + seed);
  d -= (ridge - 0.45) * 0.028;
  float wisps = fbm(p * vec2(14.0, 7.0) + seed * 2.0);
  d -= (wisps - 0.5) * 0.018 * smoothstep(0.35, 0.9, t);
  return 1.0 - smoothstep(-0.018, 0.034, d);
}

float dustyBase(vec2 uv) {
  vec2 p = uv + vec2(
    (fbm(uv * 4.0) - 0.5) * 0.08,
    (fbm(uv * 3.4 + 2.2) - 0.5) * 0.05
  );
  float mound = 1.0 - smoothstep(0.0, 0.42, p.y - 0.04 - fbm(p * 3.8) * 0.12);
  float spread = 1.0 - smoothstep(0.22, 0.78, abs(p.x - 0.48));
  return clamp(mound * spread * (0.55 + fbm(p * 7.0) * 0.55), 0.0, 1.0);
}

float pillarDensity(vec2 uv) {
  float left = organicPillar(uv, vec2(0.42, 0.08), vec2(0.30, 0.90), 0.085, 0.038, 0.055, 1.2);
  float center = organicPillar(uv, vec2(0.55, 0.10), vec2(0.58, 0.78), 0.07, 0.026, 0.012, 2.7);
  float right = organicPillar(uv, vec2(0.66, 0.12), vec2(0.72, 0.62), 0.055, 0.018, 0.008, 0.4);
  float d = max(dustyBase(uv), max(left, max(center, right)));
  float shreds = fbm(uv * 8.5 + vec2(3.1, 7.4));
  d *= mix(0.82, 1.0, shreds);
  return clamp(d, 0.0, 1.0);
}

vec3 renderPillars(vec2 uv, vec2 timeOffset, vec2 scrollOffset, float mask) {
  vec2 puv = uv + scrollOffset * 0.18 + timeOffset * 0.08;
  float density = pillarDensity(puv);
  float eps = 0.0022;
  float gx = pillarDensity(puv + vec2(eps, 0.0)) - pillarDensity(puv - vec2(eps, 0.0));
  float gy = pillarDensity(puv + vec2(0.0, eps)) - pillarDensity(puv - vec2(0.0, eps));
  float edge = length(vec2(gx, gy));
  float rim = smoothstep(0.012, 0.11, edge) * smoothstep(0.08, 0.85, density);
  float litFace = clamp(0.5 + gx * 18.0 + gy * 6.0, 0.0, 1.0);
  float dust = fbm(puv * 7.2 + vec2(1.4, 8.1));
  float height = smoothstep(0.05, 0.85, puv.y);
  vec3 dustDark = vec3(0.07, 0.03, 0.025);
  vec3 dustMid = vec3(0.28, 0.12, 0.09);
  vec3 dustLite = vec3(0.55, 0.38, 0.26);
  vec3 core = mix(dustDark, mix(dustMid, dustLite, dust), litFace * (0.35 + height * 0.4));
  vec3 cyan = vec3(0.42, 0.78, 0.82);
  vec3 lime = vec3(0.62, 0.86, 0.48);
  vec3 gold = vec3(0.86, 0.68, 0.32);
  vec3 rimCol = mix(mix(cyan, lime, height), gold, 1.0 - height);
  rimCol = mix(rimCol, mix(uColorA, uColorB, 0.45), 0.22);
  float cap = smoothstep(0.55, 0.95, puv.y) * density * rim;
  float bg = fbm(puv * 2.8 + timeOffset * 0.4 + vec2(2.1, 5.4));
  float hii = smoothstep(0.22, 0.88, bg);
  vec3 hiiCol = mix(vec3(0.05, 0.12, 0.22), vec3(0.18, 0.42, 0.48), hii);
  hiiCol = mix(hiiCol, uColorA * 0.35, 0.18);
  vec3 col = vec3(0.03, 0.045, 0.07);
  col += hiiCol * (0.55 + 0.45 * hii) * (1.0 - density * 0.88);
  col += gold * (1.0 - height) * (1.0 - density) * 0.12;
  col = mix(col, core, smoothstep(0.12, 0.78, density));
  col += rimCol * (rim * 1.35 + cap * 0.55);
  col += cyan * cap * 0.18;
  return col * mask * uIntensity;
}

// --- In main(), replace UV setup and final colour with: ---

// float rot = mix(uNebulaRot, 0.0, uPillarMode) * 1.57079632679;
// ... rotate uv ...
// float zoom = mix(uNebulaZoom, 1.0, uPillarMode);
// uv = uv / (zoom * mix(uIdleZoom, 1.0, uPillarMode * 0.65) * uTransitionZoom) + 0.5;
// ... classic nebula -> colClassic ...
// vec3 colPillars = renderPillars(uv, timeOffset, scrollOffset, mask);
// vec3 col = mix(colClassic, colPillars, clamp(uPillarMode, 0.0, 1.0));
