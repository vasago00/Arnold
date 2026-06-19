// Health-system PNG assets (desktop) — Phase 0.5 monolith slice 4. The low-poly
// system illustrations + the id→asset map, lifted from Arnold.jsx. Vite resolves
// these imports to hashed asset URLs at build time. (Paths are ../assets since
// this module lives in core/.)
import sysBrainPng      from "../assets/systems/brain.png";
import sysHeartPng      from "../assets/systems/heart.png";
import sysBonesPng      from "../assets/systems/bones.png";
import sysGutPng        from "../assets/systems/gut.png";
import sysImmunePng     from "../assets/systems/immune.png";
import sysEnergyPng     from "../assets/systems/energy.png";
import sysLongevityPng  from "../assets/systems/longevity.png";
import sysSleepPng      from "../assets/systems/sleep.png";
import sysMetabolismPng from "../assets/systems/metabolism.png";
import sysEndurancePng  from "../assets/systems/endurance.png";
import sysHormonesPng   from "../assets/systems/hormones.png";

export const SYSTEM_PNGS_DESKTOP = {
  brain: sysBrainPng, heart: sysHeartPng, bones: sysBonesPng, gut: sysGutPng,
  immune: sysImmunePng, energy: sysEnergyPng, longevity: sysLongevityPng,
  sleep: sysSleepPng, metabolism: sysMetabolismPng, endurance: sysEndurancePng,
  hormones: sysHormonesPng,
};

export default SYSTEM_PNGS_DESKTOP;
