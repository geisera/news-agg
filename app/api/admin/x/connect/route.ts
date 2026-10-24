import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {isAdmin} from '@/lib/auth';
import {random,hash,encrypt,challenge,callback,xClientId} from '@/lib/x-oauth';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const token=req.headers.get('authorization')?.slice(7)||'';
  const {createClient}=await import('@supabase/supabase-js');
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
  const {data}=await auth.auth.getUser(token);
  if(!data.user)throw Error('User session unavailable');
  const state=random(),verifier=random();
  const saved=await db().from('x_oauth_states').insert({state_hash:hash(state),verifier_cipher:encrypt(verifier),admin_id:data.user.id,expires_at:new Date(Date.now()+600000).toISOString()});
  if(saved.error)throw saved.error;
  const params=new URLSearchParams({response_type:'code',client_id:xClientId(),redirect_uri:callback,scope:'tweet.read tweet.write users.read offline.access',state,code_challenge:challenge(verifier),code_challenge_method:'S256'});
  const result=NextResponse.json({url:'https://x.com/i/oauth2/authorize?'+params});
  result.cookies.set('x_oauth_state',state,{httpOnly:true,secure:true,sameSite:'lax',path:'/api/auth/x/callback',maxAge:600});
  return result;
 }catch(e){return NextResponse.json({error:String(e)},{status:500})}
}
