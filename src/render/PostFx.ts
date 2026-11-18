import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Per-time-of-day look: bloom and a display-space colour grade. */
export interface GradeParams {
  /** bloom strength / radius / luminance threshold (linear HDR, pre tone map) */
  bloom: number;
  bloomRadius: number;
  bloomThreshold: number;
  saturation: number;
  contrast: number;
  /** multiplied into shadows / highlights (split toning) */
  shadowTint: string;
  highlightTint: string;
  /** 0..1 darkening at the frame corners */
  vignette: number;
  /** soft warm haze added toward the top of the frame (sky glow) */
  glowTint: string;
  glow: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    shadowTint: { value: new THREE.Color(1, 1, 1) },
    highlightTint: { value: new THREE.Color(1, 1, 1) },
    vignette: { value: 0 },
    glowTint: { value: new THREE.Color(1, 1, 1) },
    glow: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, vignette, glow, aspect;
    uniform vec3 shadowTint, highlightTint, glowTint;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      // Split toning: cool/warm shadows, warm highlights
      float t = smoothstep(0.0, 1.0, l);
      c *= mix(shadowTint, highlightTint, t);
      // Atmospheric glow from the top of the frame (screen blend)
      float gy = smoothstep(0.35, 1.0, vUv.y);
      c = 1.0 - (1.0 - c) * (1.0 - glowTint * glow * gy);
      // Vignette
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      c *= 1.0 - vignette * smoothstep(0.35, 0.95, length(d));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Post-processing chain: scene → (MSAA, half-float HDR) → bloom → tone map
 * + sRGB (OutputPass) → colour grade & vignette. Render-only.
 */
export class PostFx {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(private readonly gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(gl, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  set camera(cam: THREE.Camera) {
    (this.composer.passes[0] as RenderPass).camera = cam;
  }

  setParams(p: GradeParams): void {
    this.bloom.strength = p.bloom;
    this.bloom.radius = p.bloomRadius;
    this.bloom.threshold = p.bloomThreshold;
    const u = this.grade.uniforms;
    u.saturation.value = p.saturation;
    u.contrast.value = p.contrast;
    (u.shadowTint.value as THREE.Color).set(p.shadowTint);
    (u.highlightTint.value as THREE.Color).set(p.highlightTint);
    u.vignette.value = p.vignette;
    (u.glowTint.value as THREE.Color).set(p.glowTint);
    u.glow.value = p.glow;
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(w, h);
    this.grade.uniforms.aspect.value = w / Math.max(1, h);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
