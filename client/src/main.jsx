import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "";
const money = n => `$${Number(n||0).toFixed(2)}`;

function App(){
  const [tab,setTab]=useState("dashboard");
  const [state,setState]=useState({bankroll:{mattP:31.5,mattB:31.5},parlays:[],transactions:[]});
  const [showAdd,setShowAdd]=useState(false);

  async function refresh(){
  const r=await fetch(`${API}/api/state`);
  if(!r.ok) return;

  const next=await r.json();

  const liveParlays=next.parlays.filter(p=>p.status==="live");

  if(liveParlays.length){
    const players=liveParlays.flatMap(p=>
      (p.legs||[]).map(l=>({
        id:l.id,
        name:l.player,
        game:l.game,
      }))
    );

    if(players.length){
      const liveResponse=await fetch(`${API}/api/live-status`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({players}),
      });

      if(liveResponse.ok){
        const liveData=await liveResponse.json();
        const statusMap=new Map(
          (liveData.players||[]).map(x=>[x.id,x])
        );

        next.parlays=next.parlays.map(p=>({
          ...p,
          legs:(p.legs||[]).map(l=>{
            const current=statusMap.get(l.id);

            if(!current) return l;

            return {
              ...l,
              status:
                l.status==="td_scored"
                  ? "td_scored"
                  : current.status,
            };
          }),
        }));
      }
    }
  }

  setState(next);
}
  useEffect(()=>{refresh(); const t=setInterval(refresh,15000); return()=>clearInterval(t)},[]);

  const live=state.parlays.filter(p=>p.status==="live");
  const history=state.parlays.filter(p=>p.status!=="live");
  const combined=Number(state.bankroll.mattP||0)+Number(state.bankroll.mattB||0);

  return <div className="app">
    <header>
      <div className="brand"><span>🏈</span><div><h1>MATT & MATT</h1><p>TD PARLAY TRACKER</p></div></div>
      <button className="goldBtn" onClick={()=>setShowAdd(true)}>＋ ADD PARLAY</button>
    </header>
    <nav>{[
      ["dashboard","🏈 Dashboard"],["history","📜 History"],["bankroll","💰 Bankroll"],["settings","⚙️ Settings"]
    ].map(([k,v])=><button className={tab===k?"active":""} onClick={()=>setTab(k)} key={k}>{v}</button>)}</nav>

    {tab==="dashboard" && <main>
      <section className="bankrollHero">
        <div><span>COMBINED BANKROLL</span><strong>{money(combined)}</strong></div>
        <div><span>MATT P</span><b>{money(state.bankroll.mattP)}</b></div>
        <div><span>MATT B</span><b>{money(state.bankroll.mattB)}</b></div>
      </section>
      <div className="sectionTitle"><h2>🔥 LIVE PARLAYS</h2><span>{live.length} active</span></div>
      {live.length===0 ? <Empty text="No live parlays yet. Add your first DraftKings TD parlay."/> : live.map(p=><ParlayCard key={p.id} p={p} onRefresh={refresh}/>)}
      <Stats parlays={state.parlays}/>
    </main>}

    {tab==="history" && <main><div className="sectionTitle"><h2>📜 HISTORY</h2></div>{history.length?history.map(p=><ParlayCard key={p.id} p={p}/>):<Empty text="Completed parlays will appear here."/>}</main>}
    {tab==="bankroll" && <main><Bankroll state={state} refresh={refresh}/></main>}
    {tab==="settings" && <main><div className="panel"><h2>⚙️ Settings</h2><p>Matt P and Matt B are permanently configured as a 50/50 team for this first version.</p><p>Starting combined bankroll: <b>$63.00</b></p></div></main>}

    {showAdd && <AddParlay close={()=>setShowAdd(false)} refresh={refresh}/>}
  </div>
}

function Empty({text}){return <div className="panel empty">{text}</div>}

function ParlayCard({p,onRefresh}){
  const legs=p.legs||[];
  const alive=legs.filter(l=>["not_started","live"].includes(l.status)).length;
  const won=legs.filter(l=>l.status==="td_scored").length;
  const failed=legs.some(l=>l.status==="failed");
  const status=failed?"LOST":p.status==="won"?"WON":"ALIVE";
  return <article className={`parlay ${status.toLowerCase()}`}>
    <div className="parlayTop"><div><small>{new Date(p.created_at).toLocaleString()}</small><h3>{status==="ALIVE"?"🔥 ALIVE":status==="WON"?"🏆 WON":"❌ LOST"}</h3></div><div className="payout"><span>WAGER</span><b>{money(p.wager)}</b><span>POTENTIAL PAYOUT</span><b>{money(p.promo_adjusted_payout ?? p.potential_payout)}</b></div></div>
    <div className="alive">{status==="ALIVE"?`${won} scored • ${alive} alive • ${legs.length} legs`:`${won}/${legs.length} legs scored`}</div>
    <div className="legs">{legs.map((l,i)=><div className={`leg ${l.status}`} key={l.id||i}><div><b>{l.player}</b><small>{l.game} · {l.market||"Anytime TD"}</small></div><strong>{label(l.status)}</strong>{l.promo&&<em>PROMO</em>}</div>)}</div>
    <div className="pnl"><span>50/50 split</span><span>Each wager: {money(Number(p.wager)/2)}</span></div>
  </article>
}
function label(s){return {not_started:"🕐 NOT STARTED",live:"⏳ LIVE",td_scored:"✅ TD SCORED",failed:"❌ FAILED"}[s]||s}

function Stats({parlays}){
 const done=parlays.filter(p=>p.status!=="live"), wins=done.filter(p=>p.status==="won").length, wager=done.reduce((a,p)=>a+Number(p.wager||0),0), payouts=done.reduce((a,p)=>a+Number(p.actual_payout||0),0), profit=payouts-wager;
 return <section className="stats"><div className="sectionTitle"><h2>📊 SEASON STATS</h2></div><div className="statGrid">{[
  ["PARLAYS",done.length],["WINS",wins],["LOSSES",Math.max(0,done.length-wins)],["TOTAL WAGERED",money(wager)],["PAYOUTS",money(payouts)],["PROFIT",money(profit)]
 ].map(([a,b])=><div className="stat" key={a}><span>{a}</span><b>{b}</b></div>)}</div></section>
}

function AddParlay({close,refresh}){
 const [mode,setMode]=useState("import"),[text,setText]=useState(""),[legs,setLegs]=useState([]),[wager,setWager]=useState("20"),[potential,setPotential]=useState(""),[promo,setPromo]=useState(false),[confirm,setConfirm]=useState(false);
 async function parse(){const r=await fetch(`${API}/api/import/parse`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});const d=await r.json();setLegs(d.legs);setConfirm(true)}
 async function save(){const r=await fetch(`${API}/api/parlays`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wager:Number(wager),potential_payout:Number(potential||0),promo_adjusted_payout:Number(potential||0),source:mode,legs})}); if(r.ok){await refresh();close()}}
 return <div className="modal"><div className="modalBox"><div className="modalHead"><h2>➕ ADD PARLAY</h2><button onClick={close}>×</button></div>
   {!confirm?<><div className="modeRow">{["import","manual"].map(x=><button className={mode===x?"active":""} onClick={()=>setMode(x)} key={x}>{x==="import"?"📥 DraftKings Import":"✍️ Manual Entry"}</button>)}</div>
   {mode==="import"?<><p className="hint">Paste the DraftKings bet text below. One leg per line: <code>Player | Game | Anytime TD | Odds</code></p><textarea value={text} onChange={e=>setText(e.target.value)} placeholder={"Josh Jacobs | GB vs CHI | Anytime TD | +120\nPlayer Two | DET vs MIN | Anytime TD | -110"}/><div className="importChoices">📋 Paste text &nbsp; • &nbsp; 📸 Screenshot (next build) &nbsp; • &nbsp; 🔗 Share link (next build)</div><button className="goldBtn wide" onClick={parse}>PARSE & CONTINUE</button></>:<Manual setLegs={setLegs} setConfirm={setConfirm}/>}
   </>:<><h3>Confirm Parlay</h3><div className="confirmList">{legs.map((l,i)=><div className="confirmRow" key={l.id||i}><b>{l.player}</b><span>{l.game}</span><label><input type="checkbox" checked={!!l.promo} onChange={e=>setLegs(legs.map((x,j)=>j===i?{...x,promo:e.target.checked}:x))}/> Promo</label></div>)}</div><div className="formGrid"><label>Wager<input type="number" value={wager} onChange={e=>setWager(e.target.value)}/></label><label>Potential payout<input type="number" value={potential} onChange={e=>setPotential(e.target.value)} /></label></div><div className="actions"><button onClick={()=>setConfirm(false)}>BACK</button><button className="goldBtn" onClick={save}>CONFIRM & GO LIVE</button></div></>}
 </div></div>
}
function Manual({setLegs,setConfirm}){const [raw,setRaw]=useState("");return <><p className="hint">Enter one player per line. The first version uses a simple manual format.</p><textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder={"Josh Jacobs | GB vs CHI\nPlayer Two | DET vs MIN"}/><button className="goldBtn wide" onClick={()=>{setLegs(raw.split(/\n/).filter(Boolean).map((x,i)=>({id:crypto.randomUUID(),player:x.split("|")[0].trim(),game:x.split("|")[1]?.trim()||"",market:"Anytime TD",status:"not_started",promo:false})));setConfirm(true)}}>CONTINUE</button></>}

function Bankroll({state,refresh}){const [person,setPerson]=useState("mattP"),[amount,setAmount]=useState(""),[note,setNote]=useState("");async function add(sign){await fetch(`${API}/api/transactions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({person,amount:sign*Number(amount),note})});setAmount("");setNote("");refresh()}return <><div className="sectionTitle"><h2>💰 BANKROLL</h2></div><div className="panel"><div className="statGrid"><div className="stat"><span>MATT P</span><b>{money(state.bankroll.mattP)}</b></div><div className="stat"><span>MATT B</span><b>{money(state.bankroll.mattB)}</b></div></div><div className="formGrid"><label>Person<select value={person} onChange={e=>setPerson(e.target.value)}><option value="mattP">Matt P</option><option value="mattB">Matt B</option></select></label><label>Amount<input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="20"/></label></div><label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional"/></label><div className="actions"><button onClick={()=>add(1)}>＋ ADD MONEY</button><button onClick={()=>add(-1)}>− REMOVE MONEY</button></div></div></>}

createRoot(document.getElementById("root")).render(<App/>);
