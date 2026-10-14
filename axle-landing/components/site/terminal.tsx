"use client";
import {useEffect,useState} from "react";
import {AnimatePresence,motion,useReducedMotion} from "motion/react";
import {Play,RotateCcw,Check,TerminalSquare} from "lucide-react";
import {EASE} from "@/lib/motion";
import {cn} from "@/lib/cn";
const steps=[{text:"Read src/auth/session.ts",meta:"Context found"},{text:"Trace the token refresh flow",meta:"3 files inspected"},{text:"Handle an expired session",meta:"+12 −4"},{text:"Run the authentication tests",meta:"6 passed"}];
export function Terminal({className}:{className?:string}){
 const [count,setCount]=useState(0);const [running,setRunning]=useState(false);const reduce=useReducedMotion();
 useEffect(()=>{if(!running)return;if(count>=steps.length)return;const timer=setTimeout(()=>setCount(n=>n+1),reduce?50:650);return()=>clearTimeout(timer);},[running,count,reduce]);
 const complete=count===steps.length;
 return <div className={cn("terminal-demo hairline",className)}><div className="terminal-top"><span><TerminalSquare size={15}/>rivet / auth-service</span><span>Interactive demo</span></div><div className="terminal-content"><span className="mono-label">You</span><p className="terminal-prompt">“Fix the session timeout and add a regression test.”</p><div className="terminal-steps"><AnimatePresence>{steps.slice(0,count).map((step,i)=><motion.div key={step.text} initial={{opacity:0,y:reduce?0:8}} animate={{opacity:1,y:0}} transition={{duration:.4,ease:EASE}}><span className="step-check"><Check size={12}/></span><span>{step.text}</span><small>{step.meta}</small><span className="sr-only">Step {i+1} complete</span></motion.div>)}</AnimatePresence>{count===0&&<p className="terminal-idle">From a small request to a reviewable change.<br/>Press play to follow the workflow.</p>}</div><div className="terminal-outcome" aria-live="polite">{complete?<><span className="status-dot"/>Changes ready for your review.</>:running?"Working through the task…":"Your code stays in your hands."}</div></div><div className="terminal-bottom"><span>Example workflow · no code is executed</span><button onClick={()=>{if(complete){setCount(0);setRunning(false);}else setRunning(true);}} disabled={running&&!complete}>{complete?<><RotateCcw size={13}/>Replay</>:<><Play size={13}/>{running?"Running…":"Run demo"}</>}</button></div></div>;
}
