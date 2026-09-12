/** Slightly frosted regular glass — tuned for fields and panels. */
export const GLASS_FIELD_CONFIG = {
  blurAmount: 0.2,
  refraction: 0.42,
  chromAberration: 0.02,
  edgeHighlight: 0.04,
  specular: 0,
  fresnel: 0.82,
  distortion: 0,
  cornerRadius: 20,
  zRadius: 16,
  opacity: 1,
  saturation: 0,
  tintStrength: 0,
  brightness: 0.03,
  shadowOpacity: 0.18,
  shadowSpread: 8,
  shadowOffsetY: 2,
  floating: false,
  button: false,
  bevelMode: 0,
};

/** Pill controls — same glass family with button interaction. */
export const GLASS_PILL_CONFIG = {
  ...GLASS_FIELD_CONFIG,
  cornerRadius: 999,
  zRadius: 22,
  button: true,
};

export function getGlassConfig(variant = 'field') {
  return variant === 'pill' ? GLASS_PILL_CONFIG : GLASS_FIELD_CONFIG;
}
