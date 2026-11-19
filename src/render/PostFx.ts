import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

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

const GRADE_FRAG = /* glsl */ `
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float glow;
uniform float gradeAspect;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform vec3 glowTint;

vec3 kgLinearToSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

vec3 kgSRGBToLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = kgLinearToSRGB(clamp(inputColor.rgb, 0.0, 1.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  // Split toning: cool/warm shadows, warm highlights
  float t = smoothstep(0.0, 1.0, l);
  c *= mix(shadowTint, highlightTint, t);
  // Atmospheric glow from the top of the frame (screen blend)
  float gy = smoothstep(0.35, 1.0, uv.y);
  c = 1.0 - (1.0 - c) * (1.0 - glowTint * glow * gy);
  // Vignette
  vec2 d = (uv - 0.5) * vec2(gradeAspect, 1.0);
  c *= 1.0 - vignette * smoothstep(0.35, 0.95, length(d));
  outputColor = vec4(kgSRGBToLinear(clamp(c, 0.0, 1.0)), inputColor.a);
}
`;

class KarachiGradeEffect extends Effect {
  constructor() {
    super('KarachiGradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['shadowTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['highlightTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['vignette', new THREE.Uniform(0)],
        ['glowTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['glow', new THREE.Uniform(0)],
        ['gradeAspect', new THREE.Uniform(1)],
      ]),
    });
  }
}

/**
 * Tier-gated post-processing chain (render-only):
 * - Low tier: direct `gl.render(scene, camera)` with zero FBO/post passes.
 * - High tier: half-float HDR MSAA `EffectComposer` -> `RenderPass` -> single merged
 *   `EffectPass` (`BloomEffect` mipmapBlur 3 levels + ACES Filmic `ToneMappingEffect` + `KarachiGradeEffect`).
 */
export class PostFx {
  readonly tier: 'low' | 'high';
  private activeCamera: THREE.Camera;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private effectPass: EffectPass | null = null;
  private bloom: BloomEffect | null = null;
  private grade: KarachiGradeEffect | null = null;

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    camera: THREE.Camera,
    lowSpec: boolean,
  ) {
    this.tier = lowSpec ? 'low' : 'high';
    this.activeCamera = camera;

    if (!lowSpec) {
      const composer = new EffectComposer(gl, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: 4,
      });
      // EffectComposer disables gl.autoClear inside setRenderer; restore immediately
      // so direct renders (e.g. GarageScene) clear cleanly.
      this.gl.autoClear = true;

      const renderPass = new RenderPass(scene, camera);
      const bloom = new BloomEffect({
        mipmapBlur: true,
        levels: 3,
        intensity: 0.25,
        luminanceThreshold: 0.95,
        luminanceSmoothing: 0.18,
        radius: 0.4,
      });
      const toneMapping = new ToneMappingEffect({
        mode: ToneMappingMode.ACES_FILMIC,
      });
      const grade = new KarachiGradeEffect();
      const effectPass = new EffectPass(camera, bloom, toneMapping, grade);

      composer.addPass(renderPass);
      composer.addPass(effectPass);

      this.composer = composer;
      this.renderPass = renderPass;
      this.effectPass = effectPass;
      this.bloom = bloom;
      this.grade = grade;
    }
  }

  set camera(cam: THREE.Camera) {
    this.activeCamera = cam;
    if (this.renderPass) this.renderPass.mainCamera = cam;
    if (this.effectPass) this.effectPass.mainCamera = cam;
  }

  setParams(p: GradeParams): void {
    if (!this.bloom || !this.grade) return;
    this.bloom.intensity = p.bloom;
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    this.bloom.mipmapBlurPass.radius = p.bloomRadius;
    const u = this.grade.uniforms;
    u.get('saturation')!.value = p.saturation;
    u.get('contrast')!.value = p.contrast;
    (u.get('shadowTint')!.value as THREE.Color).set(p.shadowTint);
    (u.get('highlightTint')!.value as THREE.Color).set(p.highlightTint);
    u.get('vignette')!.value = p.vignette;
    (u.get('glowTint')!.value as THREE.Color).set(p.glowTint);
    u.get('glow')!.value = p.glow;
  }

  setSize(w: number, h: number): void {
    if (this.composer) {
      this.composer.setSize(w, h, false);
    }
    if (this.grade) {
      this.grade.uniforms.get('gradeAspect')!.value = w / Math.max(1, h);
    }
  }

  render(): void {
    if (!this.composer) {
      this.gl.autoClear = true;
      this.gl.setRenderTarget(null);
      this.gl.render(this.scene, this.activeCamera);
      return;
    }
    const prevAutoClear = this.gl.autoClear;
    this.gl.autoClear = false;
    this.composer.render();
    this.gl.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.composer?.dispose();
  }
}
