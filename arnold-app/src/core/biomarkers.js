// Biomarker / lab config — Phase 0.5 monolith slice 1. Extracted verbatim from
// Arnold.jsx (the BM reference table + category maps + status helper + status
// color/label maps). Pure data + one pure function, zero dependencies. The lab
// and clinical modules in Arnold.jsx import these.

export const BM = {
  "Glucose (mg/dL)":{cat:"Metabolic",opt:[72,90],warn:[90,100],unit:"mg/dL",dir:"low",lbl:"Fasting Glucose",desc:"Fasting blood sugar — high signals insulin resistance trending toward diabetes."},
  "HbA1c (%)":{cat:"Metabolic",opt:[4.6,5.3],warn:[5.3,5.7],unit:"%",dir:"low",lbl:"HbA1c",desc:"Average blood sugar over ~3 months — the long-arc glucose-control marker."},
  "Insulin (µIU/mL)":{cat:"Metabolic",opt:[2,6],warn:[6,10],unit:"µIU/mL",dir:"low",lbl:"Fasting Insulin",desc:"How hard the pancreas is working to manage glucose. High = insulin resistance."},
  "LDL Cholesterol (mg/dL)":{cat:"Lipids",opt:[40,99],warn:[99,130],unit:"mg/dL",dir:"low",lbl:"LDL",desc:"\"Bad\" cholesterol — particles that drive arterial plaque buildup."},
  "HDL Cholesterol (mg/dL)":{cat:"Lipids",opt:[60,100],warn:[50,60],unit:"mg/dL",dir:"high",lbl:"HDL",desc:"\"Good\" cholesterol — clears excess lipids back to the liver."},
  "Triglycerides (mg/dL)":{cat:"Lipids",opt:[40,100],warn:[100,150],unit:"mg/dL",dir:"low",lbl:"Triglycerides",desc:"Stored fat in blood. High = metabolic stress, often from sugar or alcohol."},
  "Total Cholesterol (mg/dL)":{cat:"Lipids",opt:[140,180],warn:[180,200],unit:"mg/dL",dir:"low",lbl:"Total Chol",desc:"Sum of all blood lipids. Less informative than LDL/HDL/ApoB on their own."},
  "ApoB (mg/dL)":{cat:"Lipids",opt:[40,80],warn:[80,100],unit:"mg/dL",dir:"low",lbl:"ApoB",desc:"Count of atherogenic particles. Best single predictor of cardiac risk."},
  "hsCRP (mg/L)":{cat:"Inflammation",opt:[0,0.5],warn:[0.5,1.0],unit:"mg/L",dir:"low",lbl:"hsCRP",desc:"Systemic inflammation marker. Tracks infection, injury, and chronic stress."},
  "Ferritin (ng/mL)":{cat:"Inflammation",opt:[50,150],warn:[150,200],unit:"ng/mL",dir:"mid",lbl:"Ferritin",desc:"Iron storage. Low = iron deficiency. High = inflammation or iron overload."},
  "Testosterone (ng/dL)":{cat:"Hormones",opt:[600,900],warn:[450,600],unit:"ng/dL",dir:"high",lbl:"Testosterone",desc:"Anabolic hormone — drives muscle, bone, libido, energy, and mood."},
  "Free testosterone (ng/dL)":{cat:"Hormones",opt:[8,15],warn:[6,8],unit:"ng/dL",dir:"high",lbl:"Free T",desc:"Bioavailable testosterone (not bound to SHBG). The active fraction."},
  "Cortisol (µg/dL)":{cat:"Hormones",opt:[8,18],warn:[18,22],unit:"µg/dL",dir:"mid",lbl:"Cortisol",desc:"Stress hormone. Chronic high = wear; chronic low = adrenal fatigue."},
  "TSH (µIU/L)":{cat:"Hormones",opt:[1.0,2.5],warn:[2.5,3.5],unit:"µIU/L",dir:"mid",lbl:"TSH",desc:"Pituitary signal to the thyroid. High TSH = thyroid under-active."},
  "SHBG (nmol/L)":{cat:"Hormones",opt:[20,55],warn:[55,70],unit:"nmol/L",dir:"mid",lbl:"SHBG",desc:"Binds sex hormones. High SHBG = less free testosterone available."},
  "Testosterone:Cortisol Ratio (Units)":{cat:"Hormones",opt:[50,100],warn:[40,50],unit:"",dir:"high",lbl:"T:C Ratio",desc:"Anabolic-to-catabolic balance. Drops during overtraining or chronic stress."},
  "Vitamin D (ng/mL)":{cat:"Nutrients",opt:[50,80],warn:[30,50],unit:"ng/mL",dir:"high",lbl:"Vitamin D",desc:"Bone, immune, mood. Low → bone loss, mood dips, weaker immunity."},
  "Vitamin B12 (pg/mL)":{cat:"Nutrients",opt:[500,900],warn:[300,500],unit:"pg/mL",dir:"high",lbl:"B12",desc:"Nerve function and red-cell synthesis. Low → fatigue, numbness, anemia."},
  "Folate (ng/mL)":{cat:"Nutrients",opt:[10,24],warn:[7,10],unit:"ng/mL",dir:"high",lbl:"Folate",desc:"DNA synthesis and red-cell maturation. Pairs with B12 for blood + nerve."},
  "Magnesium (mg/dL)":{cat:"Nutrients",opt:[2.0,2.5],warn:[1.8,2.0],unit:"mg/dL",dir:"high",lbl:"Magnesium",desc:"300+ enzyme reactions — muscle, sleep, energy. Often deficient in athletes."},
  "RBC Magnesium (mg/dL)":{cat:"Nutrients",opt:[4.2,6.0],warn:[3.5,4.2],unit:"mg/dL",dir:"high",lbl:"RBC Mg",desc:"Intracellular magnesium — better deficiency marker than serum Mg."},
  "Iron (ug/dL)":{cat:"Nutrients",opt:[70,140],warn:[50,70],unit:"µg/dL",dir:"mid",lbl:"Iron",desc:"Oxygen transport. Endurance training drains iron; low → persistent fatigue."},
  "ALT (U/L)":{cat:"Liver",opt:[7,25],warn:[25,40],unit:"U/L",dir:"low",lbl:"ALT",desc:"Liver-specific cell damage marker. Sensitive to fatty liver and alcohol."},
  "AST (U/L)":{cat:"Liver",opt:[10,30],warn:[30,40],unit:"U/L",dir:"low",lbl:"AST",desc:"Liver and muscle damage. Rises with hard training too — context matters."},
  "GGT (U/L)":{cat:"Liver",opt:[8,25],warn:[25,40],unit:"U/L",dir:"low",lbl:"GGT",desc:"Liver detox stress. Sensitive to alcohol, medications, oxidative load."},
  "Albumin (g/dL)":{cat:"Liver",opt:[4.3,5.0],warn:[4.0,4.3],unit:"g/dL",dir:"high",lbl:"Albumin",desc:"Liver-synthesised protein. Reflects nutrition status and hydration."},
  "Hemoglobin (g/dL)":{cat:"Blood",opt:[13.5,17],warn:[12,13.5],unit:"g/dL",dir:"high",lbl:"Hemoglobin",desc:"Oxygen-carrying protein in red blood cells. Low → anemia, fatigue."},
  "Hematocrit (%)":{cat:"Blood",opt:[40,50],warn:[38,40],unit:"%",dir:"mid",lbl:"Hematocrit",desc:"Percentage of blood made up of red cells. Reflects oxygen-carrying capacity."},
  "White blood cells (thousands/uL)":{cat:"Blood",opt:[4.0,7.0],warn:[3.5,4.0],unit:"K/µL",dir:"mid",lbl:"WBC",desc:"Total immune-cell count. Big shifts signal infection or immune stress."},
  "Platelets (thousands/uL)":{cat:"Blood",opt:[150,300],warn:[130,150],unit:"K/µL",dir:"mid",lbl:"Platelets",desc:"Clotting cells. Also signal repair processes and chronic inflammation."},
  "Calcium (mg/dL)":{cat:"Electrolytes",opt:[9.2,10.2],warn:[8.8,9.2],unit:"mg/dL",dir:"mid",lbl:"Calcium",desc:"Bone, muscle contraction, nerve signaling. Tightly regulated by the body."},
  "Potassium (mmol/L)":{cat:"Electrolytes",opt:[3.8,4.5],warn:[3.5,3.8],unit:"mmol/L",dir:"mid",lbl:"Potassium",desc:"Muscle, heart rhythm, nerve. Critical electrolyte for athletes."},
  "Sodium (mmol/L)":{cat:"Electrolytes",opt:[136,142],warn:[134,136],unit:"mmol/L",dir:"mid",lbl:"Sodium",desc:"Hydration and blood volume. Endurance athletes lose this through sweat."},
  "Creatine kinase (U/L)":{cat:"Inflammation",opt:[30,200],warn:[200,400],unit:"U/L",dir:"low",lbl:"CK",desc:"Muscle-damage marker. Spikes after hard training; chronic high = poor recovery."},
  "TIBC (ug/dL)":{cat:"Nutrients",opt:[250,400],warn:[220,250],unit:"µg/dL",dir:"mid",lbl:"TIBC",desc:"Iron-binding capacity. High TIBC = body upregulating carriers (iron deficient)."},
  "Transferrin saturation (%)":{cat:"Nutrients",opt:[20,45],warn:[15,20],unit:"%",dir:"mid",lbl:"Trans Sat",desc:"Percent of transferrin carrying iron. Ratio of available vs stored iron."},
  "RBC (x10E6/µL)":{cat:"Blood",opt:[4.5,5.5],warn:[4.0,4.5],unit:"M/µL",dir:"mid",lbl:"RBC",desc:"Red blood cell count — your oxygen-delivery infrastructure."},
  "eGFR (mL/min)":{cat:"Kidney",opt:[90,120],warn:[60,90],unit:"mL/min",dir:"high",lbl:"eGFR",desc:"Estimated kidney filtration rate. Lower = reduced kidney function."},
  "Creatinine (mg/dL)":{cat:"Kidney",opt:[0.7,1.2],warn:[1.2,1.4],unit:"mg/dL",dir:"low",lbl:"Creatinine",desc:"Muscle-breakdown waste cleared by kidneys. High = filtration falling behind."},
  // ── CBC differential — counts + percentages (Phase 4o.labs.3) ──────
  // All filed under "Blood" since they're part of the complete blood
  // count. Reference ranges match InsideTracker's PDF; opt is a
  // clinically reasonable sub-window inside the reference range.
  "Neutrophil count (cells/µL)":   {cat:"Blood",opt:[2500,5000],warn:[1500,7800],unit:"cells/µL",dir:"mid",lbl:"Neutrophils", desc:"Front-line bacterial-defense cells. Spike with infection or acute stress."},
  "Lymphocyte count (cells/µL)":   {cat:"Blood",opt:[1500,3000],warn:[850,3900], unit:"cells/µL",dir:"mid",lbl:"Lymphocytes", desc:"T and B cells — viral defense and long-term immune memory."},
  "Monocyte count (cells/µL)":     {cat:"Blood",opt:[300,700],  warn:[200,950],  unit:"cells/µL",dir:"mid",lbl:"Monocytes",   desc:"Tissue-cleanup immune cells. Chronic high = ongoing inflammation."},
  "Eosinophil count (cells/µL)":   {cat:"Blood",opt:[15,200],   warn:[15,500],   unit:"cells/µL",dir:"low",lbl:"Eosinophils", desc:"Allergy and parasite responders. Elevated = allergic activity."},
  "Basophil count (cells/µL)":     {cat:"Blood",opt:[0,50],     warn:[0,200],    unit:"cells/µL",dir:"low",lbl:"Basophils",   desc:"Histamine release in allergic and inflammatory reactions."},
  "Neutrophil percentage (%)":     {cat:"Blood",opt:[45,65],    warn:[39,75],    unit:"%",       dir:"mid",lbl:"Neut %",      desc:"Neutrophils as fraction of WBC. High = bacterial or acute stress."},
  "Lymphocyte percentage (%)":     {cat:"Blood",opt:[25,40],    warn:[16,47],    unit:"%",       dir:"mid",lbl:"Lymph %",     desc:"Lymphocytes as fraction of WBC. High = viral or chronic immune activity."},
  "Monocyte percentage (%)":       {cat:"Blood",opt:[5,9],      warn:[4,12],     unit:"%",       dir:"mid",lbl:"Mono %",      desc:"Monocytes as fraction of WBC. Tracks chronic inflammation."},
  "Eosinophil percentage (%)":     {cat:"Blood",opt:[0,3],      warn:[0,7],      unit:"%",       dir:"low",lbl:"Eos %",       desc:"Eosinophils as fraction of WBC. High = allergies, asthma, parasites."},
  "Basophil percentage (%)":       {cat:"Blood",opt:[0,1],      warn:[0,2],      unit:"%",       dir:"low",lbl:"Baso %",      desc:"Basophils as fraction of WBC. High = allergies or rare blood disorders."},
  // ── CBC red cell + platelet indices ──
  // MCV/MCH/MCHC characterise red-cell size and hemoglobin packing
  // (low = microcytic anemia, high = macrocytic). RDW captures size
  // dispersion (high = anisocytosis, an early anemia/inflammation
  // signal). MPV reflects platelet size — drift can flag immune or
  // marrow-stimulus changes.
  "MCV (fL)":                      {cat:"Blood",opt:[85,95],    warn:[80,100],   unit:"fL",      dir:"mid",lbl:"MCV",         desc:"Avg red-cell size. Low = microcytic (iron-def), high = macrocytic (B12/folate)."},
  "MCH (pg)":                      {cat:"Blood",opt:[28,32],    warn:[27,33],    unit:"pg",      dir:"mid",lbl:"MCH",         desc:"Average hemoglobin per red cell — pairs with MCV for anemia typing."},
  "MCHC (g/dL)":                   {cat:"Blood",opt:[33,35],    warn:[32,36],    unit:"g/dL",    dir:"mid",lbl:"MCHC",        desc:"Hemoglobin concentration in red cells (density). Stable in most cases."},
  "RDW (%)":                       {cat:"Blood",opt:[11,13],    warn:[11,15],    unit:"%",       dir:"low",lbl:"RDW",         desc:"Red-cell size variability. Rises early in anemia or chronic inflammation."},
  "MPV (fL)":                      {cat:"Blood",opt:[9,11],     warn:[7.5,12.5], unit:"fL",      dir:"mid",lbl:"MPV",         desc:"Average platelet size. Drift signals marrow activity or inflammation."},
};

export const BCATS = ["Metabolic","Lipids","Inflammation","Hormones","Nutrients","Liver","Blood","Electrolytes","Kidney"];
export const BCAT_CLR = {Metabolic:"#60a5fa",Lipids:"#f59e0b",Inflammation:"#f87171",Hormones:"#a78bfa",Nutrients:"#4ade80",Liver:"#fb923c",Blood:"#e879f9",Electrolytes:"#38bdf8",Kidney:"#94a3b8",Other:"#94a3b8"};
export const BCAT_ICO = {Metabolic:"◈",Lipids:"◉",Inflammation:"⚡",Hormones:"∿",Nutrients:"◆",Liver:"⊕",Blood:"○",Electrolytes:"⚛",Kidney:"◎",Other:"?"};

export function bStatus(name,val){
  const m=BM[name]; if(!m||val==null)return"unknown";
  const v=parseFloat(val); const[oL,oH]=m.opt; const[wL,wH]=m.warn;
  if(v>=oL&&v<=oH)return"optimal";
  if(m.dir==="low"){ if(v>wH)return"flag"; if(v>oH)return"warn"; return"optimal"; }
  if(m.dir==="high"){ if(v<wL)return"flag"; if(v<oL)return"warn"; return"optimal"; }
  if(v<wL||v>wH)return"flag"; if(v<oL||v>oH)return"warn"; return"optimal";
}

export const SC = {optimal:"var(--status-ok)",warn:"var(--status-warn)",flag:"var(--status-danger)",unknown:"var(--text-muted)"};
// Status labels (Phase 4o.labs.5) — "warn" was previously labelled
// "Monitor", which sounded alarming for values that are actually within
// the lab's reference range, just outside the user-set optimal sub-window.
// "Normal" reflects the truth: in range, not optimal. The yellow colour
// stays so the visual distinction from green/red is preserved.
export const SL = {optimal:"Optimal",warn:"Normal",flag:"Review",unknown:"—"};
export const SC_BG = {optimal:"var(--status-ok-bg)",warn:"var(--status-warn-bg)",flag:"var(--status-danger-bg)",unknown:"transparent"};
export const SC_BORDER = {optimal:"rgba(74,222,128,0.2)",warn:"rgba(245,158,11,0.2)",flag:"rgba(248,113,113,0.2)",unknown:"transparent"};
