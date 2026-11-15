import * as THREE from 'three';

/**
 * Lambert material for instanced box buildings that samples a facade atlas in
 * WORLD space, so storeys and bays keep real-world proportions whatever each
 * building's size. Atlas layout (see saddarFacadeAtlas):
 *   4 bay variants across; bottom half = 4 m ground-floor shop,
 *   top half = one 3.1 m upper storey. Roofs get a plain concrete tone.
 * Per-instance colour (setColorAt) tints the result.
 */
export const GROUND_FLOOR_H = 4;
export const STOREY_H = 3.1;
const BAY_W = 3.4;

export function setFacadeNight(mat: THREE.Material | null | undefined, amount: number): void {
  const u = mat?.userData?.nightUniform as { value: number } | undefined;
  if (u) u.value = amount;
}

/**
 * @param key unique program cache key per atlas
 * @param perBuilding one bay variant for the whole building (curtain-wall
 *   towers) instead of a random variant per bay (patchwork old blocks)
 */
export function makeFacadeMaterial(atlas: THREE.Texture, key = 'saddarFacade', perBuilding = false): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map: atlas });
  const nightUniform = { value: 0 };
  mat.userData.nightUniform = nightUniform;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacade;
        flat varying float vSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 fw = vec4(transformed, 1.0);
          mat3 nm = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            fw = instanceMatrix * fw;
            nm = nm * mat3(instanceMatrix);
          #endif
          fw = modelMatrix * fw;
          vec3 fn = normalize(nm * objectNormal);
          vec2 horiz = vec2(-fn.z, fn.x);
          float hLen = length(horiz);
          float along = hLen > 1e-4 ? dot(fw.xz, horiz / hLen) : 0.0;
          vFacade = vec3(along, fw.y, fn.y > 0.5 ? 1.0 : 0.0);
          #ifdef USE_INSTANCING
            vSeed = float(gl_InstanceID);
          #else
            vSeed = 0.0;
          #endif
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vFacade;
        flat varying float vSeed;
        float fHash(float n) { return fract(sin(n) * 43758.5453123); }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec4 texel;
          if (vFacade.z > 0.5) {
            texel = vec4(0.72, 0.70, 0.66, 1.0);
          } else {
            float bay = floor(vFacade.x / ${BAY_W.toFixed(2)});
            float u = fract(vFacade.x / ${BAY_W.toFixed(2)});
            float row = vFacade.y < ${GROUND_FLOOR_H.toFixed(1)} ? -1.0 : floor((vFacade.y - ${GROUND_FLOOR_H.toFixed(1)}) / ${STOREY_H.toFixed(2)});
            float variant = floor(fHash(${perBuilding ? 'vSeed * 0.731 + 3.1' : 'dot(vec3(bay, row, vSeed), vec3(1.37, 7.11, 0.731))'}) * 4.0);
            vec2 uv;
            float localV;
            if (row < 0.0) {
              localV = vFacade.y / ${GROUND_FLOOR_H.toFixed(1)};
              uv = vec2((variant + u) * 0.25, localV * 0.5);
            } else {
              localV = fract((vFacade.y - ${GROUND_FLOOR_H.toFixed(1)}) / ${STOREY_H.toFixed(2)});
              uv = vec2((variant + u) * 0.25, 0.5 + localV * 0.5);
            }
            // Explicit gradients from the continuous coordinate: lets mipmaps
            // work across the fract() seams between bays/storeys.
            vec2 cont = vec2(vFacade.x / ${BAY_W.toFixed(2)} * 0.25, vFacade.y / ${STOREY_H.toFixed(2)} * 0.5);
            texel = textureGrad(map, uv, dFdx(cont), dFdy(cont));
            if (uNight > 0.001) {
              float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
              float roomHash = fHash(dot(vec3(bay, row, vSeed), vec3(5.13, 13.7, 1.91)));
              float glowMask = 0.0;
              float litOn = 0.0;
              if (row < 0.0) {
                glowMask = step(0.10, u) * step(u, 0.90) * step(0.06, localV) * step(localV, 0.72) * smoothstep(${perBuilding ? '0.66, 0.34' : '0.44, 0.18'}, luma);
                litOn = step(0.32, roomHash);
              } else {
                glowMask = ${perBuilding
                  ? 'step(0.08, u) * step(u, 0.92) * step(0.18, localV) * step(localV, 0.86) * smoothstep(0.66, 0.34, luma);'
                  : 'step(0.18, u) * step(u, 0.82) * step(0.18, localV) * step(localV, 0.80) * smoothstep(0.40, 0.20, luma);'}
                litOn = step(0.54, roomHash);
              }
              vec3 warmCol = mix(vec3(1.0, 0.78, 0.42), vec3(0.84, 0.93, 1.0), step(0.72, fract(roomHash * 7.3)));
              float str = glowMask * litOn * uNight;
              totalEmissiveRadiance += warmCol * str * (row < 0.0 ? 0.95 : 0.80);
              texel.rgb = mix(texel.rgb, warmCol, clamp(str * 0.55, 0.0, 0.55));
            }
          }
          diffuseColor *= texel;
        }`,
      );
  };
  // Distinct program cache key so other Lambert materials aren't affected.
  mat.customProgramCacheKey = () => key;
  return mat;
}
