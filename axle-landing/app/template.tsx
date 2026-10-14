"use client";
import {motion} from "motion/react";
import {EASE} from "@/lib/motion";
export default function Template({children}:{children:React.ReactNode}){return <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:.4,ease:EASE}}>{children}</motion.div>;}
