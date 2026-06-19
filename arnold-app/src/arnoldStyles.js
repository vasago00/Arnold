// App-wide inline style objects — Phase 0.5 monolith slice 6. The `S` styles
// object, lifted verbatim from Arnold.jsx. Every style references the `C` palette
// (arnoldTheme.js) or a global CSS var; nothing else. Used across the whole app.
import { C } from "./arnoldTheme.js";

export const S={
  root:{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"var(--font-ui)",position:"relative"},
  bg:{position:"fixed",inset:0,backgroundImage:"none",pointerEvents:"none"},
  splash:{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:C.bg},
  si:{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"},
  pr:{position:"absolute",width:56,height:56,borderRadius:"50%",border:`1px solid ${C.acc}`,opacity:0.4},
  sl:{fontSize:26,color:C.acc},
  hdr:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 clamp(16px,2vw,40px)",height:"clamp(52px,5vw,64px)",borderBottom:`0.5px solid ${C.bs}`,background:C.bg,backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:10},
  hl:{display:"flex",alignItems:"center",gap:10},
  logo:{fontSize:22,color:C.acc,fontFamily:"var(--font-mono)"},
  an:{fontSize:"clamp(11px,0.5vw + 8px,14px)",fontWeight:600,letterSpacing:"0.18em",color:C.t,fontFamily:"var(--font-mono)"},
  as:{fontSize:10,color:C.m,letterSpacing:"0.10em",fontWeight:400},
  hr:{display:"flex",alignItems:"center",gap:14},
  un:{fontSize:"clamp(14px,0.4vw + 12px,18px)",color:"#f0f0f0",fontFamily:'"Snell Roundhand","Apple Chancery","Brush Script MT","Lucida Handwriting",cursive',fontStyle:"italic",fontWeight:600,letterSpacing:"0.03em",lineHeight:1,textShadow:"0 0 8px rgba(255,255,255,0.15)"},
  dc2:{fontSize:11,color:C.m,background:"transparent",border:"none",padding:0,fontFamily:"var(--font-mono)",lineHeight:1},
  nav:{display:"flex",borderBottom:`0.5px solid ${C.bs}`,background:C.bg,overflowX:"auto",height:"clamp(52px,5vw,64px)",position:"sticky",top:"clamp(52px,5vw,64px)",zIndex:9},
  nb:{flex:1,minWidth:44,padding:"0 4px",background:"none",border:"none",borderBottom:"2px solid transparent",color:C.s,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,transition:"color var(--transition)",fontFamily:"var(--font-ui)"},
  nba:{color:C.ta,borderBottom:`2px solid ${C.acc}`},
  ni:{fontSize:"clamp(14px,1vw + 10px,18px)"},
  nl:{fontSize:"clamp(9px,0.3vw + 8px,11px)",fontWeight:500,letterSpacing:"0.04em"},
  main:{padding:"clamp(16px,2vw,40px)",paddingBottom:60},
  sec:{display:"flex",flexDirection:"column",gap:"clamp(10px,1vw,16px)"},
  st:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.08em",color:C.m,textTransform:"uppercase",paddingBottom:8,borderBottom:`0.5px solid ${C.bs}`},
  sc:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:4},
  // Border split into individual properties so inline overrides of just
  // borderColor (used heavily in card grids) don't trigger React 19's
  // "removing style property during rerender" warning.
  sc2:{background:C.surf,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:4},
  sic:{fontSize:"clamp(14px,1vw + 10px,18px)",color:C.acc,opacity:0.8},
  sv:{fontSize:"clamp(17px,1.2vw + 11px,26px)",fontWeight:500,color:C.t,letterSpacing:"-0.02em"},
  sl2:{fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,color:C.t},
  ss:{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m},
  cg:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)"},
  snap:{background:C.surf,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
  tb:{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",background:C.surf},
  wb:{background:C.elev,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  wt2:{fontSize:"clamp(13px,0.8vw + 9px,16px)",fontWeight:500,color:C.t},
  ws:{fontSize:"clamp(10px,0.3vw + 9px,12px)",color:C.m,marginTop:4},
  ip:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  ih:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6},
  it2:{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.s,lineHeight:1.7},
  empty:{textAlign:"center",color:C.m,fontSize:"clamp(12px,0.5vw + 10px,14px)",padding:"32px 16px",border:`0.5px dashed ${C.b}`,borderRadius:"var(--radius-md)"},
  labNav:{display:"flex",gap:6,flexWrap:"wrap"},
  lnb:{background:"transparent",border:`0.5px solid ${C.b}`,color:C.s,padding:"5px 14px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"var(--font-ui)",fontSize:11,fontWeight:500,letterSpacing:"0.04em",transition:"all var(--transition)"},
  // Active state: use the full `border` shorthand instead of borderColor alone.
  // Mixing shorthand (border) and non-shorthand (borderColor) on the same
  // element triggers a React 19 warning when toggling between active/inactive
  // because removing borderColor while a `border` shorthand is set is ambiguous.
  lnba:{background:C.ad,border:`0.5px solid ${C.ab2}`,color:C.ta},
  lg:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)",display:"flex",flexDirection:"column",gap:10},
  gt:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase"},
  fr:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"clamp(10px,1vw,16px)"},
  field:{display:"flex",flexDirection:"column",gap:5},
  fl:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,letterSpacing:"0.06em",color:C.m,textTransform:"uppercase"},
  inp:{background:C.inp,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-sm)",color:C.t,padding:"10px 14px",fontFamily:"var(--font-ui)",fontSize:"clamp(13px,0.5vw + 10px,15px)",outline:"none",width:"100%",boxSizing:"border-box",transition:`border-color var(--transition),box-shadow var(--transition)`},
  ta:{background:C.inp,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-sm)",color:C.t,padding:"10px 14px",fontFamily:"var(--font-ui)",fontSize:"clamp(13px,0.5vw + 10px,15px)",resize:"vertical",minHeight:72,outline:"none",width:"100%",boxSizing:"border-box",transition:`border-color var(--transition),box-shadow var(--transition)`},
  eb:{fontSize:"clamp(10px,0.3vw + 9px,11px)",color:C.ta,background:C.ad,padding:"3px 10px",borderRadius:"var(--radius-sm)",alignSelf:"flex-start",border:`0.5px solid ${C.ab2}`},
  sb:{background:C.ad,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.ab2,borderRadius:"var(--radius-md)",padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,letterSpacing:"0.03em",cursor:"pointer",color:C.ta,width:"100%",transition:`background var(--transition),border-color var(--transition)`},
  gb:{background:"transparent",border:`0.5px solid ${C.b}`,color:C.s,borderRadius:"var(--radius-sm)",padding:"9px 16px",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,cursor:"pointer",transition:`all var(--transition)`},
  db:{background:C.dnb,border:`0.5px solid rgba(248,113,113,0.25)`,color:C.dn,padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",borderRadius:"var(--radius-md)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,cursor:"pointer",width:"100%",transition:`all var(--transition)`},
  scard:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"12px 8px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,transition:`border-color var(--transition)`},
  ic:{background:C.surf,borderWidth:"0.5px",borderStyle:"solid",borderColor:C.b,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  uz:{border:`0.5px dashed ${C.b}`,borderRadius:"var(--radius-md)",padding:20,display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",background:"transparent"},
  is:{display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:"clamp(12px,1vw,18px)",background:C.ad,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-md)",textAlign:"center"},
  aib:{background:C.ad,color:C.ta,border:`0.5px solid ${C.ab2}`,borderLeft:`3px solid ${C.acc}`,borderRadius:"var(--radius-md)",padding:"clamp(14px,1.5vw,20px) clamp(20px,2vw,32px)",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",fontWeight:500,letterSpacing:"0.03em",cursor:"pointer",display:"flex",alignItems:"center",gap:8,justifyContent:"center",width:"100%",boxSizing:"border-box",transition:`background var(--transition),border-color var(--transition)`},
  qb:{background:C.surf,border:`0.5px solid ${C.b}`,color:C.s,padding:"9px 12px",borderRadius:"var(--radius-sm)",cursor:"pointer",fontFamily:"var(--font-ui)",fontSize:"clamp(12px,0.5vw + 10px,14px)",textAlign:"left",transition:`all var(--transition)`},
  ab:{background:C.ad,color:C.ta,border:`0.5px solid ${C.ab2}`,borderRadius:"var(--radius-sm)",padding:"0 14px",fontFamily:"var(--font-ui)",fontWeight:500,fontSize:"clamp(12px,0.5vw + 10px,14px)",cursor:"pointer",whiteSpace:"nowrap",transition:`all var(--transition)`},
  air:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  aih:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8},
  ait:{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.s,lineHeight:1.75,whiteSpace:"pre-wrap"},
  aisp:{background:C.surf,border:`0.5px solid ${C.b}`,borderRadius:"var(--radius-md)",padding:"clamp(12px,1vw,18px)"},
  aish:{fontSize:"clamp(10px,0.3vw + 9px,11px)",fontWeight:500,color:C.ta,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,display:"flex",alignItems:"center",gap:6},
  aist:{fontSize:"clamp(13px,0.5vw + 10px,15px)",color:C.s,lineHeight:1.85,whiteSpace:"pre-wrap"},
  toast:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"var(--status-ok-bg)",color:"var(--text-accent)",border:"0.5px solid var(--accent-border)",padding:"10px 20px",borderRadius:"var(--radius-sm)",fontWeight:500,fontSize:13,zIndex:100,backdropFilter:"blur(8px)"},
};

export default S;
