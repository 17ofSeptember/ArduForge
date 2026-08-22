/**
 * Token generator (THEME.md Phase 0.2). Emits client/src/styles/tokens.css.
 *
 * tokens.css is generated, not hand-written: change the inputs here and
 * regenerate, then run `npm run contrast` to verify. Hand-editing a hex in the
 * output is what the contrast gate exists to catch.
 *
 *   npm run tokens && npm run contrast
 *
 * All colour work happens in OKLCH so hue survives lightness and chroma
 * changes. sRGB <-> OKLab per Bjoern Ottosson; contrast is WCAG 2.1.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../client/src/styles/tokens.css');

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hexToRgb = (h0) => { const h = h0.replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); };
const rgbToHex = ([r, g, b]) => { const f = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'); return `#${f(r)}${f(g)}${f(b)}`.toUpperCase(); };
function rgbToOklab([r, g, b]) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553*l+0.793617785*m-0.0040720468*s, 1.9779984951*l-2.428592205*m+0.4505937099*s, 0.0259040371*l+0.7827717662*m-0.808675766*s];
}
function oklabToRgb([L, a, bb]) {
  const l_=L+0.3963377774*a+0.2158037573*bb, m_=L-0.1055613458*a-0.0638541728*bb, s_=L-0.0894841775*a-1.291485548*bb;
  const l=l_**3, m=m_**3, s=s_**3;
  return [toSrgb(4.0767416621*l-3.3077115913*m+0.2309699292*s), toSrgb(-1.2684380046*l+2.6097574011*m-0.3413193965*s), toSrgb(-0.0041960863*l-0.7034186147*m+1.707614701*s)];
}
const D = 180 / Math.PI;
function oklch(hx) { const [L,a,b]=rgbToOklab(hexToRgb(hx)); let h=Math.atan2(b,a)*D; if(h<0)h+=360; return {L,C:Math.hypot(a,b),h}; }
const raw = ({L,C,h}) => oklabToRgb([L, C*Math.cos(h/D), C*Math.sin(h/D)]);
const inG = (r) => r.every((v) => v >= -0.0001 && v <= 1.0001);
function hex(o) {
  if (inG(raw(o))) return rgbToHex(raw(o));
  let lo=0, hi=o.C;
  for (let i=0;i<40;i+=1){const mid=(lo+hi)/2; if(inG(raw({...o,C:mid})))lo=mid; else hi=mid;}
  return rgbToHex(raw({...o,C:lo}));
}
const lum = (h) => { const [r,g,b]=hexToRgb(h).map(toLinear); return 0.2126*r+0.7152*g+0.0722*b; };
const cr = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
const r2 = (n) => Math.round(n*100)/100;
const okstr = (o) => `oklch(${(o.L*100).toFixed(1)}% ${o.C.toFixed(3)} ${o.h.toFixed(1)})`;
function fit(seed, bgs, target, dir) {
  const b = typeof seed === 'string' ? oklch(seed) : seed;
  for (let L=b.L; L>=0 && L<=1; L+=dir*0.002) { const c=hex({...b,L}); if (bgs.every((g)=>cr(c,g)>=target)) return {hex:c, oklch:{...b,L}}; }
  return { hex: hex(b), oklch: b };
}

function solveL(h, C, targetY) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (lum(hex({ L: mid, C, h })) < targetY) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Geometric luminance ladder. `top` is set by the contrast bar against the
 * light background; each rung sits `ratio` apart so the set keeps its greyscale
 * separation instead of bunching at the threshold.
 */
function ladder(top, ratio, count) {
  const out = [top];
  for (let i = 1; i < count; i += 1) out.push((out[i - 1] + 0.05) / ratio - 0.05);
  return out;
}

const P = { crimson:'#B80C09', slate:'#0B4F6C', cyan:'#01BAEF', ghost:'#FBFBFF', black:'#040F16' };
const H = Object.fromEntries(Object.entries(P).map(([k,v])=>[k,oklch(v)]));
const SLATE_H = H.slate.h;

// ── ramps ────────────────────────────────────────────────────────────────────
const STEPS=[50,100,200,300,400,500,600,700,800,900,950];
const STEP_L=[0.989,0.955,0.905,0.840,0.755,0.660,0.565,0.470,0.375,0.265,0.161];
function ramp(hx, neutral) {
  const base = oklch(hx);
  const peak = neutral ? Math.max(base.C,0.012) : Math.max(base.C,0.09);
  let anchor=0;
  for(let i=1;i<STEP_L.length;i+=1) if(Math.abs(STEP_L[i]-base.L)<Math.abs(STEP_L[anchor]-base.L)) anchor=i;
  return STEPS.map((step,i)=>{
    if(i===anchor) return {step, hex:hx.toUpperCase(), oklch:base, anchored:true};
    const L=STEP_L[i];
    const spread = neutral?0.60:0.42;
    const C = peak * Math.exp(-((L-base.L)**2)/(2*spread**2)) * Math.max(0.15, Math.min(1,(1-L)/0.10, L/0.12));
    return {step, hex:hex({L,C,h:base.h}), oklch:{L,C,h:base.h}};
  });
}
const RAMPS = { cyan:ramp(P.cyan,false), slate:ramp(P.slate,false), crimson:ramp(P.crimson,false), ghost:ramp(P.ghost,true), ink:ramp(P.black,true) };
const S = (n,s) => RAMPS[n].find((x)=>x.step===s).hex;

const rep=[];
const say=(s='')=>rep.push(s);

// ── elevation ────────────────────────────────────────────────────────────────
const el = (L,C) => hex({L,C,h:SLATE_H});
const DARK = { app:P.black, panel:el(0.235,0.030), card:el(0.295,0.036), header:el(0.350,0.042), input:el(0.205,0.028), popover:el(0.375,0.045), modal:el(0.320,0.039) };
const LIGHT = { app:el(0.905,0.018), panel:el(0.945,0.011), card:el(0.968,0.007), header:el(0.878,0.022), input:el(0.930,0.014), popover:P.ghost, modal:P.ghost };
const DK=Object.values(DARK), LT=Object.values(LIGHT);

// Light-mode semantic sets are placed by target CONTRAST RATIO against the
// panel, not by fitting each colour to a threshold independently. Fitting
// independently walks every colour to the same stopping point, which collapses
// the greyscale spread to 1.00:1 - the contrast gate caught exactly that.
const panelY = lum(LIGHT.panel);
const yFor = (ratio) => (panelY + 0.05) / ratio - 0.05;
const ADJ=[['app','panel'],['panel','card'],['card','header'],['card','input'],['card','popover'],['app','modal'],['panel','popover'],['app','input']];

say('## Elevation ladder\n');
say('| Level | Dark | Light |');
say('|---|---|---|');
for(const k of Object.keys(DARK)) say(`| \`--bg-${k}\` | \`${DARK[k]}\` | \`${LIGHT[k]}\` |`);
say('\n| Adjacent pair | Dark | Light |');
say('|---|---|---|');
for(const [a,b] of ADJ) say(`| ${a} → ${b} | ${r2(cr(DARK[a],DARK[b]))}:1 | ${r2(cr(LIGHT[a],LIGHT[b]))}:1 |`);

// ── text ─────────────────────────────────────────────────────────────────────
const textDark = { primary:S('ghost',50), secondary:fit({...oklch('#90B3C4'),C:0.042},DK,4.6,+1).hex, muted:fit({L:0.55,C:0.030,h:SLATE_H},DK,4.6,+1).hex };
const textLight = { primary:P.black, secondary:fit({L:0.55,C:0.070,h:SLATE_H},LT,4.6,-1).hex, muted:fit({L:0.60,C:0.050,h:SLATE_H},LT,4.6,-1).hex };
const destructive = { dark: fit(P.crimson,DK,4.6,+1), light: fit(P.crimson,LT,4.6,-1) };
const primaryText = { dark: fit(P.cyan,DK,4.6,+1), light: fit(P.cyan,LT,4.6,-1) };

say('\n## Text (worst case across all seven surfaces)\n');
say('| Token | Dark | min | Light | min |');
say('|---|---|---|---|---|');
for(const k of ['primary','secondary','muted'])
  say(`| \`--text-${k}\` | \`${textDark[k]}\` | ${r2(Math.min(...DK.map((b)=>cr(textDark[k],b))))}:1 | \`${textLight[k]}\` | ${r2(Math.min(...LT.map((b)=>cr(textLight[k],b))))}:1 |`);
say(`| \`--text-link\` | \`${primaryText.dark.hex}\` | ${r2(Math.min(...DK.map((b)=>cr(primaryText.dark.hex,b))))}:1 | \`${primaryText.light.hex}\` | ${r2(Math.min(...LT.map((b)=>cr(primaryText.light.hex,b))))}:1 |`);
say(`| \`--text-inverse\` | \`${P.black}\` | on fills | \`${P.ghost}\` | on fills |`);

// ── semantic anchor ──────────────────────────────────────────────────────────
const anchorC = (H.cyan.C + destructive.dark.oklch.C)/2;

// Lightness is spread evenly over a band that keeps hues vivid, and ORDERED so
// that colour-vision-confusable pairs (red/green, amber/green, blue/cyan) are
// the furthest apart in lightness rather than the closest.
const CAT_ORDER = ['events','custom','math','components','control','serial','variables','logic','io','time'];
const CAT_SRC = { events:'#8B5CF6', io:'#F5A524', control:'#E5484D', math:'#3E9EFF', logic:'#0EA5E9', variables:'#30A46C', time:'#EAB308', serial:'#94A3B8', components:'#EC4899', custom:'#64748B' };
const NEUTRAL_CATS = new Set(['serial','custom']);
const CAT_LO=0.620, CAT_HI=0.870;
const catHex={}, catOk={};
CAT_ORDER.forEach((k,i)=>{
  const L = CAT_LO + (CAT_HI-CAT_LO)*i/(CAT_ORDER.length-1);
  const o = { L, C: NEUTRAL_CATS.has(k) ? 0.028 : anchorC, h: oklch(CAT_SRC[k]).h };
  catOk[k]=o; catHex[k]=hex(o);
});

say('\n## Node categories (harmonized)\n');
say(`Anchor chroma **C = ${anchorC.toFixed(3)}**, the mean of Electric Cyan (${H.cyan.C.toFixed(3)}) and the lightened crimson (${destructive.dark.oklch.C.toFixed(3)}). Hue is preserved exactly from the BUILD_PLAN table; only L and C are re-derived.\n`);
say('| Category | Old | New | OKLCH | vs black header text | vs dark card |');
say('|---|---|---|---|---|---|');
for(const k of Object.keys(CAT_SRC))
  say(`| ${k} | \`${CAT_SRC[k]}\` | \`${catHex[k]}\` | \`${okstr(catOk[k])}\` | ${r2(cr(catHex[k],'#000000'))}:1 | ${r2(cr(catHex[k],DARK.card))}:1 |`);

// Light-mode categories are squeezed between two hard bounds: light enough that
// --text-on-semantic (black) clears 4.5:1 on the header, dark enough to stay
// 3:1 from the light card. That band is only ~1.21x wide in total, so ten
// categories can be spread at best ~1.022x apart — tight, but not the 1.00x
// that fitting each one independently produced.
// Bounded by the light label above (<= ~0.17 keeps white text at 4.5:1) and by
// keeping the darkest category from going muddy.
const catLightTop = 0.142;
const catLightBottom = 0.05;
const catLight = {};
CAT_ORDER.forEach((k, i) => {
  // Preserve the dark ordering so a category keeps its relative weight.
  const t = i / (CAT_ORDER.length - 1);
  const targetY = catLightBottom * Math.pow(catLightTop / catLightBottom, t);
  const o = catOk[k];
  catLight[k] = hex({ L: solveL(o.h, o.C, targetY), C: o.C, h: o.h });
});

const gs = Object.entries(catHex).map(([n,h])=>({n,y:lum(h)})).sort((a,b)=>a.y-b.y);
say('\n**Greyscale ladder** (Phase 6.2 desaturation test):\n');
say('| Category | Relative luminance | vs previous |');
say('|---|---|---|');
gs.forEach((g,i)=>{ const p=gs[i-1]; say(`| ${g.n} | ${g.y.toFixed(4)} | ${p?`${((g.y+0.05)/(p.y+0.05)).toFixed(3)}× vs ${p.n}`:'—'} |`); });
const worstGs = Math.min(...gs.slice(1).map((g,i)=>(g.y+0.05)/(gs[i].y+0.05)));
say(`\nWorst adjacent pair: **${worstGs.toFixed(3)}×**. Theoretical ceiling for 10 steps across this band is ${(((gs[9].y+0.05)/(gs[0].y+0.05))**(1/9)).toFixed(3)}×.`);

// ── ports ────────────────────────────────────────────────────────────────────
const PORT_ORDER = ['int','string','bool','any','float','pin'];
const PORT_SRC = { bool:'#E5484D', int:'#3E9EFF', float:'#30A46C', string:'#C86EDD', pin:'#F5A524', any:'#8B8D98' };
const portDark={}, portLight={};
PORT_ORDER.forEach((k,i)=>{
  const L = 0.660 + (0.865-0.660)*i/(PORT_ORDER.length-1);
  const o = { L, C: k==='any'?0.014:anchorC, h: oklch(PORT_SRC[k]).h };
  portDark[k]=hex(o);
  portLight[k]=fit(o,[LIGHT.app,LIGHT.card],3.2,-1).hex;
});
// exec is the maximum-contrast neutral in each theme: near-white on dark,
// near-black on light. A white exec edge is invisible on a light canvas.
portDark.exec = S('ghost',50);
portLight.exec = S('ink',800);

say('\n## Port types (3:1 bar against the canvas)\n');
say('| Port | Old | Dark | vs dark canvas | Light | vs light canvas |');
say('|---|---|---|---|---|---|');
for(const k of ['exec','bool','int','float','string','pin','any'])
  say(`| ${k} | \`${k==='exec'?'#F5F5F5':PORT_SRC[k]}\` | \`${portDark[k]}\` | ${r2(cr(portDark[k],DARK.app))}:1 | \`${portLight[k]}\` | ${r2(cr(portLight[k],LIGHT.app))}:1 |`);

// ── connection status ────────────────────────────────────────────────────────
// Light-mode ratios chosen so the SS3.7 separations hold by construction:
// stale/connected is 8.5/3.8 = 2.24x regardless of what the ground turns out to be.
// Live pin state (THEME.md Phase 5). HIGH/LOW must stay unambiguous AND must not
// be confusable with the connection status sitting in the same panel — which
// already owns green (connected), amber (connecting), cyan (streaming), grey
// (idle) and crimson (error). Violet is the one family left, so HIGH takes it.
// The button also carries the literal text "HIGH"/"LOW", so colour is the
// redundancy here rather than the only signal.
const PIN_SPEC = {
  high: { L: 0.700, C: anchorC, h: oklch('#8B5CF6').h },
  low:  { L: 0.320, C: 0.030,   h: SLATE_H },
};
const pinDark = Object.fromEntries(Object.entries(PIN_SPEC).map(([k,o])=>[k, hex(o)]));
const pinLight = {
  high: hex({ ...PIN_SPEC.high, L: solveL(PIN_SPEC.high.h, PIN_SPEC.high.C, 0.12) }),
  low:  hex({ L: 0.880, C: 0.020, h: SLATE_H }),
};

const CONN_RATIOS = { connecting:3.05, connected:3.8, streaming:4.7, error:5.6, idle:6.8, stale:8.5 };
const CONN_SPEC = {
  idle:       { L:0.600, C:0.022,   h:SLATE_H },
  stale:      { L:0.645, C:0.045,   h:45 },
  connected:  { L:0.745, C:anchorC, h:oklch('#30A46C').h },
  connecting: { L:0.830, C:anchorC, h:oklch('#F5A524').h },
  streaming:  { L:0.885, C:anchorC, h:H.cyan.h },
  error:      destructive.dark.oklch,
};
const conn = Object.fromEntries(Object.entries(CONN_SPEC).map(([k,o])=>[k, hex(o)]));
say('\n## Connection status (dark)\n');
say('| State | Value | vs app bg |');
say('|---|---|---|');
for(const [k,v] of Object.entries(conn)) say(`| ${k} | \`${v}\` | ${r2(cr(v,DARK.app))}:1 |`);
say(`\n\`stale\` vs \`connected\`: **${r2(cr(conn.stale,conn.connected))}:1** and chroma 0.055 vs ${anchorC.toFixed(3)} — stale reads visibly washed out. §3.7 requires these never be confused.`);
say(`\`connected\` vs \`streaming\`: ${r2(cr(conn.connected,conn.streaming))}:1. \`connected\` vs \`connecting\`: ${r2(cr(conn.connected,conn.connecting))}:1.`);

// ── charts ───────────────────────────────────────────────────────────────────
const SERIES_SPEC = [
  { L:0.755, h:H.cyan.h },
  { L:0.620, h:oklch('#EC4899').h },
  { L:0.870, h:oklch('#EAB308').h },
  { L:0.680, h:oklch('#30A46C').h },
];
const seriesDark = SERIES_SPEC.map((o)=>hex({...o, C:anchorC}));
// Ratios are 1.25 apart, so every pair clears the 1.20 greyscale bar. The
// lightest series starts at 4:1 rather than 3:1 so it still clears 3:1 against
// the gridline sitting between it and the panel.
const SERIES_RATIOS = [4.0, 5.0, 6.25, 7.8];
const seriesLight = new Array(seriesDark.length);
seriesDark
  .map((h, i) => ({ i, y: lum(h) }))
  .sort((a, b) => b.y - a.y)
  .forEach(({ i }, rank) => {
    const { h } = SERIES_SPEC[i];
    seriesLight[i] = hex({ L: solveL(h, anchorC, yFor(SERIES_RATIOS[rank])), C: anchorC, h });
  });
const gridDark = el(0.290,0.030), gridLight = el(0.885,0.014);
const connLight = Object.fromEntries(Object.entries(CONN_SPEC).map(([k, o]) => [
  k,
  hex({ L: solveL(o.h, o.C, yFor(CONN_RATIOS[k])), C: o.C, h: o.h }),
]));
say('\n### Light-mode connection status\n');
say('| State | Value | vs panel |');
say('|---|---|---|');
for(const [k,v] of Object.entries(connLight)) say(`| ${k} | \`${v}\` | ${r2(cr(v,LIGHT.panel))}:1 |`);
say(`\nstale vs connected: **${r2(cr(connLight.stale,connLight.connected))}:1**`);

say('\n## Chart series\n');
say('| Series | Dark | Light | vs dark app | vs dark grid |');
say('|---|---|---|---|---|');
seriesDark.forEach((h,i)=>say(`| ${i+1} | \`${h}\` | \`${seriesLight[i]}\` | ${r2(cr(h,DARK.app))}:1 | ${r2(cr(h,gridDark))}:1 |`));
say('\nPairwise greyscale separation (1.20:1 bar):\n');
say('| Pair | Ratio |');
say('|---|---|');
for(let i=0;i<4;i+=1) for(let j=i+1;j<4;j+=1) say(`| ${i+1} v ${j+1} | ${r2(cr(seriesDark[i],seriesDark[j]))}:1 |`);
say(`\nGrid \`${gridDark}\` is ${r2(cr(gridDark,DARK.app))}:1 against the app background — deliberately subordinate to every series.`);

// ── feedback ─────────────────────────────────────────────────────────────────
const feedback={};
for(const [k,src] of Object.entries({success:'#30A46C', warning:'#F5A524', info:'#3E9EFF'})) {
  const h = oklch(src).h;
  feedback[k] = { dark: fit({L:0.72,C:anchorC,h},DK,4.6,+1).hex, light: fit({L:0.72,C:anchorC,h},LT,4.6,-1).hex };
}
feedback.destructive = { dark: destructive.dark.hex, light: destructive.light.hex };
say('\n## Feedback\n');
say('| Token | Dark | min | Light | min |');
say('|---|---|---|---|---|');
for(const [k,v] of Object.entries(feedback))
  say(`| \`--feedback-${k}\` | \`${v.dark}\` | ${r2(Math.min(...DK.map((b)=>cr(v.dark,b))))}:1 | \`${v.light}\` | ${r2(Math.min(...LT.map((b)=>cr(v.light,b))))}:1 |`);

// ── syntax ───────────────────────────────────────────────────────────────────
const SYN = { keyword:{s:'#C86EDD',L:0.720}, type:{s:'#0EA5E9',L:0.780}, string:{s:'#30A46C',L:0.745}, number:{s:'#F5A524',L:0.820}, function:{s:'#3E9EFF',L:0.740}, preprocessor:{s:'#EC4899',L:0.700}, operator:{s:'#94A3B8',L:0.800,C:0.020}, punctuation:{s:'#94A3B8',L:0.700,C:0.018}, comment:{s:'#0B4F6C',L:0.640,C:0.030} };
const synDark={}, synLight={};
const edDark=DARK.panel, edLight=LIGHT.panel;
for(const [k,v] of Object.entries(SYN)) {
  const o = { L:v.L, C:v.C ?? anchorC*0.92, h:oklch(v.s).h };
  synDark[k] = fit(o,[edDark],4.6,+1).hex;
  synLight[k] = fit(o,[edLight],4.6,-1).hex;
}
synDark.error = destructive.dark.hex; synLight.error = destructive.light.hex;
say('\n## C++ syntax\n');
say('| Token | Dark | vs editor | Light | vs editor |');
say('|---|---|---|---|---|');
for(const k of Object.keys(synDark))
  say(`| \`--syntax-${k}\` | \`${synDark[k]}\` | ${r2(cr(synDark[k],edDark))}:1 | \`${synLight[k]}\` | ${r2(cr(synLight[k],edLight))}:1 |`);

// ── remaining groups ─────────────────────────────────────────────────────────
const focus = { dark:S('cyan',400), light:S('cyan',700) };
const border = {
  dark:  { subtle:el(0.330,0.035), default:el(0.430,0.050), strong:el(0.570,0.066) },
  light: { subtle:el(0.870,0.020), default:el(0.780,0.036), strong:el(0.600,0.062) },
};
const disabled = {
  dark:  { bg:el(0.245,0.020), text:fit({L:0.50,C:0.020,h:SLATE_H},[DARK.card],2.5,+1).hex, border:el(0.310,0.022) },
  light: { bg:el(0.920,0.010), text:fit({L:0.70,C:0.020,h:SLATE_H},[LIGHT.card],2.5,-1).hex, border:el(0.850,0.014) },
};
const selected = {
  dark:  { bg:hex({L:0.300,C:0.060,h:H.cyan.h}), border:S('cyan',400), text:textDark.primary },
  light: { bg:hex({L:0.930,C:0.045,h:H.cyan.h}), border:S('cyan',600), text:textLight.primary },
};
const scrollbar = {
  dark:  { thumb:el(0.400,0.040), hover:el(0.500,0.050), track:'transparent' },
  light: { thumb:el(0.800,0.028), hover:el(0.700,0.040), track:'transparent' },
};

say('\n## Focus, borders, disabled, selection\n');
say('| Token | Dark | Light | Check |');
say('|---|---|---|---|');
say(`| \`--focus-ring\` | \`${focus.dark}\` | \`${focus.light}\` | min ${r2(Math.min(...DK.map((b)=>cr(focus.dark,b))))}:1 / ${r2(Math.min(...LT.map((b)=>cr(focus.light,b))))}:1 across every surface (3:1 bar) |`);
for(const k of ['subtle','default','strong'])
  say(`| \`--border-${k}\` | \`${border.dark[k]}\` | \`${border.light[k]}\` | vs card ${r2(cr(border.dark[k],DARK.card))}:1 / ${r2(cr(border.light[k],LIGHT.card))}:1 |`);
say(`| \`--bg-disabled\` | \`${disabled.dark.bg}\` | \`${disabled.light.bg}\` | — |`);
say(`| \`--text-disabled\` | \`${disabled.dark.text}\` | \`${disabled.light.text}\` | ${r2(cr(disabled.dark.text,DARK.card))}:1 / ${r2(cr(disabled.light.text,LIGHT.card))}:1 — deliberately below body text (WCAG 1.4.3 exempts disabled controls) |`);
say(`| \`--border-selected\` | \`${selected.dark.border}\` | \`${selected.light.border}\` | vs card ${r2(cr(selected.dark.border,DARK.card))}:1 / ${r2(cr(selected.light.border,LIGHT.card))}:1 |`);
say(`| \`--bg-selected\` | \`${selected.dark.bg}\` | \`${selected.light.bg}\` | primary text ${r2(cr(textDark.primary,selected.dark.bg))}:1 / ${r2(cr(textLight.primary,selected.light.bg))}:1 |`);

say('\n## Filled controls\n');
say('| Fill | Label | Ratio |');
say('|---|---|---|');
const fills=[['`--bg-interactive` (cyan-400)',P.black,S('cyan',400)],['`--bg-destructive` (crimson-700)',P.ghost,S('crimson',700)],['`--bg-structural` (slate primitive)',P.ghost,P.slate]];
for(const [n,fg,bg] of fills) say(`| ${n} \`${bg}\` | \`${fg}\` | ${r2(cr(fg,bg))}:1 |`);

// ── emit tokens.css ──────────────────────────────────────────────────────────
const rampBlock = Object.entries(RAMPS).map(([n,steps]) =>
  `  /* ${n}${n==='ink'?' — Rich Black':n==='ghost'?' — Ghost White':''} */\n` +
  steps.map((s)=>`  --ramp-${n}-${s.step}: ${s.hex};`).join('\n')
).join('\n\n');

const scheme = (mode) => {
  const E = mode==='dark'?DARK:LIGHT, T = mode==='dark'?textDark:textLight;
  const B=border[mode], DIS=disabled[mode], SEL=selected[mode], SC=scrollbar[mode];
  const port = mode==='dark'?portDark:portLight;
  const syn = mode==='dark'?synDark:synLight;
  const series = mode==='dark'?seriesDark:seriesLight;
  const grid = mode==='dark'?gridDark:gridLight;
  const shadowRgb = mode==='dark'?'0 0 0':'11 40 56';
  const shadowA = mode==='dark'?[0.45,0.55,0.65]:[0.08,0.12,0.18];
  return `  color-scheme: ${mode};

  /* Elevation — app → panel → card → header → input → popover → modal */
  --bg-app: ${E.app};
  --bg-panel: ${E.panel};
  --bg-card: ${E.card};
  --bg-header: ${E.header};
  --bg-input: ${E.input};
  --bg-popover: ${E.popover};
  --bg-modal: ${E.modal};
  /* Full-saturation Slate Blue: structural chrome only (toolbar, sidebar).
     It carries inverse text exclusively — never body text. */
  --bg-structural: ${P.slate};

  /* Typography */
  --text-primary: ${T.primary};
  --text-secondary: ${T.secondary};
  --text-muted: ${T.muted};
  --text-link: ${mode==='dark'?primaryText.dark.hex:primaryText.light.hex};
  --text-on-structural: ${P.ghost};
  /* Sits on a node-category header, port chip, or status pill.
     Dark theme: headers are light, so the label is dark.
     Light theme: headers are dark, so the label is light.
     Holding it dark in both squeezes the light-mode header band between "light
     enough for dark text" and "dark enough to separate from a white card"
     until ten categories cannot be told apart in greyscale. */
  --text-on-semantic: ${mode==='dark'?P.black:P.ghost};

  /* Interactive fills */
  --bg-interactive: ${S('cyan',400)};
  --bg-interactive-hover: ${S('cyan',300)};
  --bg-interactive-active: ${S('cyan',500)};
  --text-on-interactive: ${P.black};
  --bg-destructive: ${S('crimson',700)};
  --bg-destructive-hover: ${S('crimson',600)};
  --text-on-destructive: ${P.ghost};

  /* Borders */
  --border-subtle: ${B.subtle};
  --border-default: ${B.default};
  --border-strong: ${B.strong};

  /* Focus — verified ≥3:1 on every surface level above */
  --focus-ring: ${mode==='dark'?focus.dark:focus.light};
  --focus-ring-offset: ${mode==='dark'?E.app:P.ghost};

  /* Disabled */
  --bg-disabled: ${DIS.bg};
  --text-disabled: ${DIS.text};
  --border-disabled: ${DIS.border};

  /* Selection */
  --bg-selected: ${SEL.bg};
  --border-selected: ${SEL.border};
  --text-selected: ${SEL.text};

  /* Feedback */
  --feedback-success: ${feedback.success[mode]};
  --feedback-warning: ${feedback.warning[mode]};
  --feedback-info: ${feedback.info[mode]};
  --feedback-destructive: ${feedback.destructive[mode]};

  /* Overlay */
  --scrim: rgb(4 15 22 / ${mode==='dark'?'0.70':'0.45'});
  --shadow-color: ${shadowRgb};
  --shadow-1: 0 1px 2px rgb(${shadowRgb} / ${shadowA[0]});
  --shadow-2: 0 4px 12px rgb(${shadowRgb} / ${shadowA[1]});
  --shadow-3: 0 16px 40px rgb(${shadowRgb} / ${shadowA[2]});

  /* Scrollbar */
  --scrollbar-thumb: ${SC.thumb};
  --scrollbar-thumb-hover: ${SC.hover};
  --scrollbar-track: ${SC.track};

  /* Connection status — six states; \`stale\` is desaturated so frozen values
     can never be mistaken for live ones (BUILD_PLAN §3.7). */
${['idle','connecting','connected','streaming','stale','error'].map((k)=>`  --conn-${k}: ${mode==='dark'?conn[k]:connLight[k]};`).join('\n')}

  /* Live pin state — deliberately outside the connection-status hue set */
  --pin-high: ${mode==='dark'?pinDark.high:pinLight.high};
  --pin-low: ${mode==='dark'?pinDark.low:pinLight.low};

  /* Node categories — harmonized; hue preserved, L/C re-derived */
${Object.keys(CAT_SRC).map((k)=>`  --cat-${k}: ${mode==='dark'?catHex[k]:catLight[k]};`).join('\n')}

  /* Port types */
${['exec','bool','int','float','string','pin','any'].map((k)=>`  --port-${k}: ${port[k]};`).join('\n')}

  /* Chart series — spread in lightness so they survive desaturation */
${series.map((v,i)=>`  --chart-series-${i+1}: ${v};`).join('\n')}
  --chart-grid: ${grid};
  --chart-axis: ${T.muted};

  /* C++ syntax */
${Object.keys(synDark).map((k)=>`  --syntax-${k}: ${syn[k]};`).join('\n')}`;
};

const css = `/**
 * ArduForge design tokens — the single source of colour for the app.
 *
 * Structure (THEME.md Phase 0):
 *   1. Ramps      — 11-step OKLCH scales generated from the five palette
 *                   primitives. Everything below references a ramp step or a
 *                   derived value; nothing references a raw primitive.
 *   2. Chrome     — app shell, surfaces, typography, controls. Themed.
 *   3. Semantic   — node categories, port types, chart series, syntax,
 *                   connection status. Hue-preserving, harmonized to the
 *                   palette's chroma envelope so they read as one family.
 *   4. Tailwind   — @theme inline, mapping chrome tokens to utilities and
 *                   removing Tailwind's default palette.
 *
 * The pre-migration @theme block was deleted in Phase 3, once every component
 * had moved onto the tokens above.
 *
 * Every value here was generated and contrast-verified in OKLCH. Do not
 * hand-edit a hex: change the generator inputs and regenerate, then re-run
 * scripts/contrast-check.ts (added in Phase 1).
 *
 * Palette primitives:
 *   Crimson       #B80C09  destructive / error
 *   Slate Blue    #0B4F6C  structural / secondary
 *   Electric Cyan #01BAEF  primary interactive
 *   Ghost White   #FBFBFF  light background / inverse text
 *   Rich Black    #040F16  dark background / primary text
 */
@import 'tailwindcss';

/* Tailwind v4 auto-detects sources but skips anything .gitignore matches. That
   silently dropped every class in client/src/build/ for as long as .gitignore
   carried an unanchored \`build/\`. Declaring the source explicitly means a
   future ignore rule cannot quietly un-style a directory again. */
@source '../../src/**/*.{ts,tsx}';

/* ═══════════════════════════════════════════════════════════════════════════
   1. RAMPS — theme-independent. Generated in OKLCH at fixed lightness steps so
   steps are comparable across hues. The step nearest each primitive's own
   lightness is snapped back to the exact primitive.
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
${rampBlock}
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. THEMES

   Light is the \`:root\` default so the cascade has a complete palette even if
   the pre-paint script in index.html fails. Dark is applied by explicit
   \`data-theme\`, and by system preference when the user has expressed no
   choice. The app defaults to dark — see client/src/styles/theme.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

:root {
${scheme('light')}
}

:root[data-theme='dark'] {
${scheme('dark')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${scheme('dark').split('\n').map((l)=>l?`  ${l}`:l).join('\n')}
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. TAILWIND (THEME.md Phase 2)

   Tailwind v4 is configured in CSS, not in a \`tailwind.config.ts\` — that file
   does not exist in this project and v4 does not read one. \`@theme\` is the
   equivalent, and the \`inline\` keyword is load-bearing here: it substitutes the
   token reference into the generated utility, so \`bg-card\` resolves against
   whichever \`--bg-card\` is in scope. A plain \`@theme\` would snapshot the value
   into \`:root\` and the utilities would not follow \`data-theme\`.

   Token names here deliberately do not collide with the legacy block below.
   Both are live during the migration; Phase 3 moves components onto these and
   deletes the legacy block.

   Only CHROME is exposed as utilities. Node categories, port types, chart
   series, syntax, and connection status are consumed by React Flow, uPlot and
   CodeMirror through JS, not through className — Phase 4 wires those to the
   custom properties directly. Generating utilities for them would create the
   second, competing styling system THEME.md warns about.
   ═══════════════════════════════════════════════════════════════════════════ */

@theme {
  /* Remove Tailwind's default palette. With it reachable, \`bg-slate-800\` keeps
     working and hardcoded utilities creep back in until the theme rots. There
     are currently zero uses of it in client/src (verified in Phase 0). */
  --color-*: initial;

  /* No exceptions. Phase 3 moved the last 26 \`text-black\` / \`text-white\` /
     \`bg-black/60\` sites onto --text-on-semantic, --text-on-interactive,
     --text-on-destructive and --scrim, so nothing reaches for a raw colour any
     more. The matching ESLint rule bans black and white alongside the palette. */
}

@theme inline {
  /* Surfaces */
  --color-app: var(--bg-app);
  --color-panel: var(--bg-panel);
  --color-card: var(--bg-card);
  --color-header: var(--bg-header);
  --color-input: var(--bg-input);
  --color-popover: var(--bg-popover);
  --color-modal: var(--bg-modal);
  --color-structural: var(--bg-structural);

  /* Typography */
  --color-content: var(--text-primary);
  --color-content-secondary: var(--text-secondary);
  --color-content-muted: var(--text-muted);
  --color-link: var(--text-link);
  --color-on-structural: var(--text-on-structural);
  --color-on-semantic: var(--text-on-semantic);
  --color-pin-high: var(--pin-high);
  --color-pin-low: var(--pin-low);

  /* Borders */
  --color-edge: var(--border-default);
  --color-edge-subtle: var(--border-subtle);
  --color-edge-strong: var(--border-strong);

  /* Interactive fills */
  --color-interactive: var(--bg-interactive);
  --color-interactive-hover: var(--bg-interactive-hover);
  --color-interactive-active: var(--bg-interactive-active);
  --color-on-interactive: var(--text-on-interactive);
  --color-destructive: var(--bg-destructive);
  --color-destructive-hover: var(--bg-destructive-hover);
  --color-on-destructive: var(--text-on-destructive);

  /* Feedback — text and icon colours, distinct from the destructive fill */
  --color-success: var(--feedback-success);
  --color-warning: var(--feedback-warning);
  --color-info: var(--feedback-info);
  --color-error: var(--feedback-destructive);

  /* State */
  --color-selected: var(--bg-selected);
  --color-selected-edge: var(--border-selected);
  --color-disabled: var(--bg-disabled);
  --color-disabled-content: var(--text-disabled);
  --color-disabled-edge: var(--border-disabled);
  --color-focus: var(--focus-ring);
  --color-focus-offset: var(--focus-ring-offset);

  /* Overlay and scrollbar */
  --color-scrim: var(--scrim);
  --color-scroll-thumb: var(--scrollbar-thumb);
  --color-scroll-thumb-hover: var(--scrollbar-thumb-hover);

  /* Elevation shadows. Named e1/e2/e3 rather than sm/md/lg so they do not
     override Tailwind's defaults, which shadow-lg/xl/2xl still use today. */
  --shadow-e1: var(--shadow-1);
  --shadow-e2: var(--shadow-2);
  --shadow-e3: var(--shadow-3);

  --font-mono: ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace;
}

html,
body,
#root {
  height: 100%;
}

body {
  background-color: var(--bg-app);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  /*
   * This is an app shell, not a document: the header and status bar are fixed
   * furniture and each panel scrolls its own content. Letting the document
   * scroll instead strands that furniture mid-page, so the page itself never
   * scrolls.
   */
  overflow: hidden;
}

/*
 * React Flow (THEME.md Phase 4). Every one of these is an override point the
 * library documents, and every one of them beats passing a prop: React Flow
 * renders through SVG and CSS, so a var() here follows a theme change with no
 * rebuild and no subscription.
 *
 * Verified against @xyflow/react's own markup — MiniMap nodes are <rect> with a
 * style.fill, and the Background is an SVG <pattern>. Neither touches a canvas,
 * so neither needs a resolved value.
 */
.react-flow {
  --xy-background-color: var(--bg-app);
  --xy-background-pattern-dots-color: var(--border-subtle);
  --xy-background-pattern-lines-color: var(--border-subtle);
  --xy-background-pattern-cross-color: var(--border-subtle);

  --xy-edge-stroke: var(--port-any);
  --xy-edge-stroke-selected: var(--border-selected);
  --xy-connectionline-stroke: var(--port-any);

  --xy-handle-background-color: var(--bg-card);
  --xy-handle-border-color: var(--border-strong);

  --xy-selection-background-color: color-mix(in oklch, var(--bg-selected) 45%, transparent);
  --xy-selection-border: 1px dashed var(--border-selected);

  --xy-controls-button-background-color: var(--bg-card);
  --xy-controls-button-background-color-hover: var(--bg-header);
  --xy-controls-button-color: var(--text-secondary);
  --xy-controls-button-color-hover: var(--text-primary);
  --xy-controls-button-border-color: var(--border-subtle);
  --xy-controls-box-shadow: var(--shadow-2);

  --xy-minimap-background-color: var(--bg-panel);
  --xy-minimap-mask-background-color: var(--scrim);

  --xy-edge-label-background-color: var(--bg-card);
  --xy-edge-label-color: var(--text-primary);

  --xy-attribution-background-color: transparent;
}

/*
 * Focus (THEME.md Phase 3 item 3). One ring for every control, so it cannot get
 * lost on one surface and not another — the contrast gate verifies --focus-ring
 * clears 3:1 against all seven elevation levels in both themes.
 *
 * Element+pseudo-class beats the \`.outline-none\` utility on specificity, and
 * :focus-visible fires only for keyboard focus, so clicking a button still does
 * not draw a ring.
 */
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* Scrollbars (THEME.md Phase 3 item 8). Firefox takes the two-value shorthand;
   WebKit needs the pseudo-elements. Both read the same tokens. */
* {
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  scrollbar-width: thin;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}

::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-corner {
  background: transparent;
}
`;

writeFileSync(OUT, css);
// Count the light scheme only — dark and the media-query copy repeat it.
const tokenCount = (scheme('light').match(/^\s+--[a-z0-9-]+:/gm) ?? []).length;
const utilityCount = (css.match(/^\s+--(?:color|shadow)-[a-z0-9-]+: var\(/gm) ?? []).length;
const rampCount = (css.match(/--ramp-[a-z]+-\d+:/g) ?? []).length;
say(`\n## Totals\n\n${tokenCount} themed tokens per scheme, ${rampCount} ramp steps, ${utilityCount} Tailwind utility mappings.`);
console.log(rep.join('\n'));
console.error(
  `\nWROTE tokens.css — ${tokenCount} themed tokens x2 schemes, ${rampCount} ramp steps, ` +
    `${utilityCount} Tailwind utility mappings`,
);
