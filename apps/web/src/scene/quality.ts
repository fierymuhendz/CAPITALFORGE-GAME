import type { GraphicsQuality } from "./types";

export type GraphicsPref = "auto" | "high" | "low" | "lite";

let webglCache: boolean | null = null;

/** WebGL kullanılabilir mi (bir kez denenir, sonuç saklanır) */
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    webglCache = !!gl;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

interface NavExt { deviceMemory?: number }

/**
 * Kalite seçimi. Sunucuda (window yok) "low" döner; tarayıcıda hesaplanır.
 * auto: WebGL yoksa lite; az bellek/çekirdek, küçük dokunmatik ekran veya "azaltılmış hareket" ise low.
 */
export function detectQuality(pref: GraphicsPref): GraphicsQuality {
  if (pref === "lite") return "lite";
  if (typeof window === "undefined") return "low";
  if (!hasWebGL()) return "lite";
  if (pref === "high" || pref === "low") return pref;

  const mem = (navigator as Navigator & NavExt).deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(window.screen.width, window.screen.height) < 768;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  if (reduced) return "low";
  if (mem !== undefined && mem <= 2) return "low";
  if (cores <= 4) return "low";
  if (small && coarse && !(mem !== undefined && mem >= 6 && cores >= 8)) return "low";
  return "high";
}
