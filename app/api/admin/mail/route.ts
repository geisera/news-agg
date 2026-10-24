import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {isAdmin,auditAdmin} from '@/lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const inbox='6760afe9-8c07-4e80-aaed-583e0c20501a';
const uuid=z.string().uuid();
async function resend(path:string,init:RequestInit={}){
 const key=process.env.RESEND_API_KEY;
 if(!key)throw Error('RESEND_API_KEY is not configured in Vercel');
 const r=await fetch('https://api.resend.com/inboxes/'+inbox+path,{...init,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...init.headers},cache:'no-store',signal:AbortSignal.timeout(12000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error('Resend returned '+r.status+': '+(d.message||'Unable to fetch email'));
 return d;
}
const fail=(e:unknown)=>NextResponse.json({error:e instanceof Error?e.message:'Email service unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const p=req.nextUrl.searchParams,thread=p.get('thread'),email=p.get('email');
 if((thread&&!uuid.safeParse(thread).success)||(email&&(!thread||!uuid.safeParse(email).success)))return NextResponse.json({error:'Invalid message identifier'},{status:400});
 try{
  const prefix=thread?'/threads/'+thread:'';
  let result;
  if(email){const data=await resend(prefix+'/emails/'+email);result={id:data.id,text:typeof data.text==='string'?data.text:'',subject:data.subject}}
  else if(thread){const [data,info]=await Promise.all([resend(prefix+'/emails?limit=50'),resend(prefix)]);result={id:thread,subject:info.subject,emails:data.data||[]}}
  else result=await resend('/threads?folders=inbox&limit=40');
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return fail(e)}
}
const reply=z.object({threadId:uuid,emailId:uuid,text:z.string().trim().min(1).max(20000)});
export async function POST(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const v=reply.safeParse(await req.json().catch(()=>null));
 if(!v.success)return NextResponse.json({error:'Invalid reply'},{status:400});
 try{const {threadId,emailId,text}=v.data;const r=await resend('/threads/'+threadId+'/emails/'+emailId+'/reply',{method:'POST',body:JSON.stringify({text}),headers:{'Idempotency-Key':crypto.randomUUID()}});await auditAdmin(req,'email.reply');return NextResponse.json({id:r.id},{headers:{'Cache-Control':'no-store'}})}
 catch(e){return fail(e)}
}
