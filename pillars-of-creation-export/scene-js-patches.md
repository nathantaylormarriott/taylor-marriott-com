# scene.js integration patches

## 1. Initial state (near top of createScene)

```js
const initialPillarMode = config.nebula.variant === 'pillars' ? 1 : 0;
const nebulaTarget = {
  colorA: colorA.clone(),
  colorB: colorB.clone(),
  intensity: config.nebula.intensity,
  pillarMode: initialPillarMode,
};
const nebulaCurrent = {
  colorA: colorA.clone(),
  colorB: colorB.clone(),
  intensity: config.nebula.intensity,
  pillarMode: initialPillarMode,
};
```

## 2. Nebula uniforms

```js
uPillarMode: { value: initialPillarMode },
```

## 3. Fragment shader

Add `uniform float uPillarMode;` and paste all functions from `shaders/pillar-nebula.glsl`.

In `main()`:
- Use pillar-aware rotation/zoom (see GLSL file comments at bottom).
- Keep classic cloud path as `colClassic`.
- Blend: `mix(colClassic, colPillars, clamp(uPillarMode, 0.0, 1.0))`.

## 4. Render loop (inside render())

```js
nebulaCurrent.pillarMode = lerp(nebulaCurrent.pillarMode, nebulaTarget.pillarMode, 0.045);
nebulaMat.uniforms.uPillarMode.value = nebulaCurrent.pillarMode;
```

## 5. setNebula API

```js
setNebula: ({ colorA, colorB, intensity, variant }) => {
  if (colorA) nebulaTarget.colorA.set(colorA);
  if (colorB) nebulaTarget.colorB.set(colorB);
  if (intensity != null) nebulaTarget.intensity = intensity;
  if (variant != null) nebulaTarget.pillarMode = variant === 'pillars' ? 1 : 0;
},
```

## 6. Shell.jsx (or route theming)

Pass full theme object including `variant`:

```js
sceneApiRef.current?.setNebula?.(SCENE_THEMES.muslims.nebula);
```
