// Health-system SVG icons — ONE definition (Phase 0.3 / 3.2 dedup). These 10
// inline SVGs were copied THREE times: byte-identical @16px in Arnold.jsx and
// NutritionInput.jsx, and again @14px (`SYSTEM_ICONS_M`) in MobileHome.jsx. They
// now live here once; `size` defaults to 16 (web) and mobile passes 14.
// Each entry is `(color, size=16) => <svg…>`. Pure presentational SVG, no deps.
export const SYSTEM_ICONS = {
  brain: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8 2 5 5 5 9c0 2 .5 3.5 1.5 5 .8 1.2 1 2.5 1 4h9c0-1.5.2-2.8 1-4 1-1.5 1.5-3 1.5-5 0-4-3-7-7-7z"/><path d="M9 18h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2z"/><path d="M12 2v16"/><path d="M6.5 8c2 1 3.5 1.5 5.5 1.5s3.5-.5 5.5-1.5"/><path d="M7 12.5c1.5.8 3 1 5 1s3.5-.2 5-1"/></svg>,
  heart: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>,
  bones: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/><line x1="6" y1="12" x2="18" y2="12"/><rect x="5" y="7" width="2" height="10" rx="0.5"/><rect x="17" y="7" width="2" height="10" rx="0.5"/></svg>,
  gut: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10c1.5 0 2.5 1 2.5 2.5S18.5 9 17 9H7c-1.5 0-2.5 1-2.5 2.5S6 14 7 14h10"/><path d="M17 14c1.5 0 2.5 1 2.5 2.5S18.5 19 17 19H7"/><circle cx="5" cy="19" r="1.2" fill={c} stroke="none"/></svg>,
  immune: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L4 7v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7l-8-5Z"/></svg>,
  energy: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>,
  longevity: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>,
  sleep: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  metabolism: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h4l2-8 4 16 2-8h4"/></svg>,
  endurance: (c, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c4-6 8-6 12 0s8 6 12 0"/></svg>,
};

export default SYSTEM_ICONS;
