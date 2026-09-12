import * as THREE from 'three';

/**
 * Unicorn Studio waterRipple from gentlerain-ai-gc / WaterEffect/effect.json.
 * Sim, normals, 11-tap gaussian, refraction, IOR, chromatic aberration, and
 * lighting use the original constants. Shadow is multiplied (not subtracted)
 * so the same 3D liquid reads on a dark nebula instead of going black.
 * https://thesiyhbrand.github.io/gentlerain-ai-gc/
 */
export function createWaterRipple(renderer, { isMobile = false, displacementCanvas = null } = {}) {
  const simSize = isMobile ? 512 : 1024;
  const speed = 0.88;
  const damping = 0.8 + (0.999 - 0.8) * 0.64;
  const refractionAmount = 0.01 + (0.4 - 0.01) * 0.85;
  const lightingMix = 0.62;
  const normalStrength = 1.0 + (7.0 - 1.0) * 0.85;
  const normalStep = (1.0 + (3.0 - 1.0) * 0.85) / 1080.0;
  const blurSpread = 0.005 + (0.015 - 0.005) * 0.69;

  const simRtOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  };

  let width = 0;
  let height = 0;
  let sceneTarget = null;
  let enabled = true;

  const pingA = new THREE.WebGLRenderTarget(simSize, simSize, simRtOpts);
  const pingB = new THREE.WebGLRenderTarget(simSize, simSize, simRtOpts);
  const normalTarget = new THREE.WebGLRenderTarget(simSize, simSize, simRtOpts);
  const blurTarget = new THREE.WebGLRenderTarget(simSize, simSize, simRtOpts);
  pingA.texture.colorSpace = THREE.NoColorSpace;
  pingB.texture.colorSpace = THREE.NoColorSpace;
  normalTarget.texture.colorSpace = THREE.NoColorSpace;
  blurTarget.texture.colorSpace = THREE.NoColorSpace;

  let readPing = pingA;
  let writePing = pingB;

  const mouse = new THREE.Vector2(0.5, 0.5);
  const prevMouse = new THREE.Vector2(0.5, 0.5);
  let hasMouse = false;
  let rippleEnergy = 0;
  let dispTick = 0;

  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const postMesh = new THREE.Mesh(quadGeo);
  postScene.add(postMesh);

  const dispSize = 256;
  const dispTarget = displacementCanvas
    ? new THREE.WebGLRenderTarget(dispSize, dispSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      })
    : null;
  const dispPixels = displacementCanvas ? new Uint8Array(dispSize * dispSize * 4) : null;
  const dispCtx = displacementCanvas ? displacementCanvas.getContext('2d', { willReadFrequently: true }) : null;
  let dispImage = null;

  function syncFeImage(canvas) {
    const feImage = document.querySelector('#hero-water-ripple feImage');
    const feMap = document.querySelector('#hero-water-ripple feDisplacementMap');
    if (!feImage) return;
    const url = canvas.toDataURL('image/png');
    feImage.setAttribute('href', url);
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
    if (feMap) feMap.setAttribute('scale', '140');
  }

  if (dispCtx) {
    displacementCanvas.width = dispSize;
    displacementCanvas.height = dispSize;
    dispImage = dispCtx.createImageData(dispSize, dispSize);
    dispCtx.fillStyle = 'rgb(128, 128, 128)';
    dispCtx.fillRect(0, 0, dispSize, dispSize);
    syncFeImage(displacementCanvas);
  }

  const vert = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const simMat = new THREE.ShaderMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPingPongTexture: { value: pingA.texture },
      uPreviousMousePos: { value: new THREE.Vector2(0.5, 0.5) },
      uMousePos: { value: new THREE.Vector2(0.5, 0.5) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSpeed: { value: speed },
      uDamping: { value: damping },
    },
    vertexShader: vert,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uPingPongTexture;
      uniform vec2 uPreviousMousePos;
      uniform vec2 uMousePos;
      uniform vec2 uResolution;
      uniform float uSpeed;
      uniform float uDamping;
      const float PI = 3.1415926;

      void main() {
        vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
        vec2 texelSize = (1.0 / (vec2(1080.0) * aspect)) * mix(1.0, 8.0, uSpeed);
        vec2 mPos = (uMousePos - 0.5) * 0.5 + 0.5;
        vec2 pmPos = (uPreviousMousePos - 0.5) * 0.5 + 0.5;

        float scaleDiff = 0.25;
        vec2 clampRegionMin = vec2(0.5 - scaleDiff);
        vec2 clampRegionMax = vec2(1.0 - 0.5 + scaleDiff);

        vec4 data = texture2D(uPingPongTexture, vUv);
        float height = data.r;
        float velocity = data.g;

        float laplacian = 0.0;
        float totalWeight = 0.0;
        vec2 offsets[4];
        offsets[0] = vec2(texelSize.x, 0.0);
        offsets[1] = vec2(-texelSize.x, 0.0);
        offsets[2] = vec2(0.0, texelSize.y);
        offsets[3] = vec2(0.0, -texelSize.y);

        for (int i = 0; i < 4; i++) {
          vec2 offset = offsets[i];
          vec2 neighborUv = clamp(vUv + offset, clampRegionMin, clampRegionMax);
          float weight = 1.0 - length(offset) / (length(texelSize) * 2.0);
          laplacian += texture2D(uPingPongTexture, neighborUv).r * weight;
          totalWeight += weight;
        }

        laplacian = laplacian / totalWeight - height;
        velocity += laplacian;
        velocity *= uDamping;
        height += velocity;
        height *= uDamping;

        float mouseSpeed = distance(mPos, pmPos);
        float dist = distance(vUv * aspect, mPos * aspect);
        float radius = 0.025;
        if (dist < radius && mouseSpeed > 0.0001) {
          float drop = cos(dist / radius * PI * 0.5);
          height += drop * mouseSpeed * 20.0;
        }

        gl_FragColor = vec4(height, velocity, 0.0, 1.0);
      }
    `,
  });

  const normalMat = new THREE.ShaderMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPingPongTexture: { value: pingA.texture },
      uStrength: { value: normalStrength },
      uStep: { value: normalStep },
    },
    vertexShader: vert,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uPingPongTexture;
      uniform float uStrength;
      uniform float uStep;

      void main() {
        vec2 scaled = (vUv - 0.5) * 0.5 + 0.5;
        float left = texture2D(uPingPongTexture, scaled + vec2(-uStep, 0.0)).r;
        float right = texture2D(uPingPongTexture, scaled + vec2(uStep, 0.0)).r;
        float top = texture2D(uPingPongTexture, scaled + vec2(0.0, -uStep)).r;
        float bottom = texture2D(uPingPongTexture, scaled + vec2(0.0, uStep)).r;
        vec3 normal;
        normal.x = (right - left) * uStrength;
        normal.y = -(bottom - top) * uStrength;
        normal.z = -1.0;
        gl_FragColor = vec4(normalize(normal), 1.0);
      }
    `,
  });

  const blurMat = new THREE.ShaderMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTexture: { value: null },
      uDir: { value: new THREE.Vector2(1, 0) },
      uSpread: { value: blurSpread },
    },
    vertexShader: vert,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec2 uDir;
      uniform float uSpread;

      float getGaussianWeight(int index) {
        if (index == 0) return 0.7978845608028654;
        if (index == 1) return 0.795118932516684;
        if (index == 2) return 0.7868794322038799;
        if (index == 3) return 0.7733362336056986;
        if (index == 4) return 0.7547664553859864;
        if (index == 5) return 0.7315447328280048;
        if (index == 6) return 0.704130653528599;
        if (index == 7) return 0.6730536454899063;
        if (index == 8) return 0.6388960110447045;
        if (index == 9) return 0.6022748643096089;
        if (index == 10) return 0.5638237508206051;
        if (index == 11) return 0.5241747061566029;
        return 0.0;
      }

      void main() {
        vec4 color = vec4(0.0);
        float totalWeight = 0.0;
        float centerWeight = getGaussianWeight(0);
        color += texture2D(uTexture, vUv) * centerWeight;
        totalWeight += centerWeight;
        for (int i = 1; i <= 11; i++) {
          float weight = getGaussianWeight(i);
          float offsetAmt = uSpread * float(i) / 11.0;
          vec2 off = uDir * offsetAmt;
          color += texture2D(uTexture, vUv + off) * weight;
          color += texture2D(uTexture, vUv - off) * weight;
          totalWeight += 2.0 * weight;
        }
        gl_FragColor = color / totalWeight;
      }
    `,
  });

  const compositeMat = new THREE.ShaderMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uNormalMap: { value: null },
      uBgTexture: { value: null },
      uRefraction: { value: refractionAmount },
      uLighting: { value: lightingMix },
    },
    vertexShader: vert,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uNormalMap;
      uniform sampler2D uBgTexture;
      uniform float uRefraction;
      uniform float uLighting;

      const vec3 LIGHT_POS = vec3(2.0, 2.0, 3.0);
      const vec3 VIEW_POS = vec3(0.0, 0.0, 2.0);
      const float SPECULAR = 2.4;
      const float SHININESS = 128.0;

      vec3 chromaticAberration(vec3 color, vec2 uv) {
        vec2 offset = (uv - vUv) * 0.05;
        float r = texture2D(uBgTexture, clamp(uv - offset, 0.001, 0.999)).r;
        float b = texture2D(uBgTexture, clamp(uv + offset, 0.001, 0.999)).b;
        return vec3(r, color.g, b);
      }

      vec3 calculateLighting(vec3 normal, vec2 uv) {
        vec3 worldPos = vec3(uv * 2.0 - 1.0, 0.0);
        vec3 lightDir = normalize(LIGHT_POS - worldPos);
        vec3 viewDir = normalize(VIEW_POS - worldPos);
        vec3 reflectDir = reflect(-lightDir, normal);
        float diff = max(dot(normal, lightDir), 0.0);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), SHININESS) * SPECULAR;
        return vec3(diff + spec);
      }

      void main() {
        vec3 normal = texture2D(uNormalMap, vUv).rgb;
        vec3 I = vec3(0.0, 0.0, 1.0);
        vec3 refracted = refract(I, normal, 1.0 / 1.333);
        vec2 refractedUv = clamp(vUv + refracted.xy * uRefraction, 0.001, 0.999);
        vec3 refractedNormal = texture2D(uNormalMap, refractedUv).rgb;
        vec3 col = texture2D(uBgTexture, refractedUv).rgb;
        col = chromaticAberration(col, refractedUv);

        float causticsShadow = dot(normal, normalize(vec3(2.0, -2.0, 3.0) - vec3(vUv * 2.0 - 1.0, 0.0))) + 1.0;
        float shadowFactor = mix(1.0, causticsShadow, uLighting);
        vec3 lightingFactor = mix(vec3(0.0), calculateLighting(refractedNormal, refractedUv), uLighting);
        float wave = clamp(length(normal.xy) * 2.4, 0.0, 1.0);
        vec3 spec = lightingFactor / (1.0 + lightingFactor);
        col *= mix(1.0, max(shadowFactor, 0.5), wave);
        col += spec;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const dispExportMat = new THREE.ShaderMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTexture: { value: null },
      uRefraction: { value: refractionAmount },
    },
    vertexShader: vert,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uRefraction;
      void main() {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
        vec3 normal = texture2D(uTexture, uv).rgb;
        gl_FragColor = vec4(normal.xy * 0.5 + 0.5, 0.5, 1.0);
      }
    `,
  });

  function syncSize() {
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    if (w === width && h === height && sceneTarget) return;
    width = w;
    height = h;
    sceneTarget?.dispose();
    sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    sceneTarget.texture.colorSpace = THREE.NoColorSpace;
    compositeMat.uniforms.uBgTexture.value = sceneTarget.texture;
    simMat.uniforms.uResolution.value.set(w, h);
  }

  function setEnabled(value) {
    enabled = !!value;
    if (!enabled) rippleEnergy = 0;
  }

  function setMouseUV(x, y) {
    if (!enabled) return;
    mouse.set(x, y);
    if (!hasMouse) {
      prevMouse.copy(mouse);
      hasMouse = true;
    }
  }

  function blit(material, target) {
    postMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCam);
  }

  function stepSimulation() {
    simMat.uniforms.uPingPongTexture.value = readPing.texture;
    blit(simMat, writePing);
    const swap = readPing;
    readPing = writePing;
    writePing = swap;
  }

  function exportDisplacement() {
    if (!dispTarget || !dispCtx || !dispPixels || !dispImage) return;
    dispExportMat.uniforms.uTexture.value = normalTarget.texture;
    blit(dispExportMat, dispTarget);
    renderer.readRenderTargetPixels(dispTarget, 0, 0, dispSize, dispSize, dispPixels);
    dispImage.data.set(dispPixels);
    dispCtx.putImageData(dispImage, 0, 0);
    dispTick += 1;
    if (dispTick % 2 === 0) syncFeImage(displacementCanvas);
  }

  function renderDirect(scene, camera, prevAutoClear) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
  }

  function render(scene, camera) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    if (!enabled) {
      renderDirect(scene, camera, prevAutoClear);
      prevMouse.copy(mouse);
      return;
    }

    syncSize();

    if (mouse.distanceToSquared(prevMouse) > 1e-10) rippleEnergy = 1;

    simMat.uniforms.uPreviousMousePos.value.copy(prevMouse);
    simMat.uniforms.uMousePos.value.copy(mouse);

    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);

    stepSimulation();

    normalMat.uniforms.uPingPongTexture.value = readPing.texture;
    blit(normalMat, normalTarget);

    blurMat.uniforms.uTexture.value = normalTarget.texture;
    blurMat.uniforms.uDir.value.set(1, 0);
    blit(blurMat, blurTarget);
    blurMat.uniforms.uTexture.value = blurTarget.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    blit(blurMat, normalTarget);

    if (rippleEnergy > 0.01) exportDisplacement();

    compositeMat.uniforms.uNormalMap.value = normalTarget.texture;
    blit(compositeMat, null);
    renderer.setRenderTarget(null);
    renderer.autoClear = prevAutoClear;
    prevMouse.copy(mouse);
    rippleEnergy *= 0.985;
  }

  function dispose() {
    sceneTarget?.dispose();
    pingA.dispose();
    pingB.dispose();
    normalTarget.dispose();
    blurTarget.dispose();
    dispTarget?.dispose();
    quadGeo.dispose();
    simMat.dispose();
    normalMat.dispose();
    blurMat.dispose();
    compositeMat.dispose();
    dispExportMat.dispose();
  }

  syncSize();

  return {
    setSize: syncSize,
    setEnabled,
    setMouseUV,
    render,
    dispose,
  };
}
