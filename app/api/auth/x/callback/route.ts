import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {hash,decrypt,exchange,storeTokens,callback} from '@/lib/x-oauth';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const state=req.nextUrl.searchParams.get('state')||'';
 const cookie=req.cookies.get('x_oauth_state')?.value||'';
 const code=req.nextUrl.searchParams.get('code')||'';
 const target=new URL('/admin?x_oauth=error',req.url);
 const response=(ok:boolean)=>{const r=NextResponse.redirect(new URL('/admin?x_oauth='+(ok?'connected':'error'),req.url));r.cookies.delete('x_oauth_state');return r};
 if(!state||!cookie||state!==cookie||!code||req.nextUrl.searchParams.has('error'))return response(false);
 try{
  const client=db();
  const rows=await client.from('x_oauth_states').delete().eq('state_hash',hash(state)).gt('expires_at',new Date().toISOString()).select('verifier_cipher,admin_id').single();
  if(rows.error||!rows.data)return response(false);
  const tokens=await exchange(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:decrypt(rows.data.verifier_cipher)}));
  const who=await fetch('https://api.x.com/2/users/me',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(8000)});
  if(!who.ok)throw Error('Unable to verify X identity');
  const json=await who.json();
  await storeTokens(tokens,json.data?.username);
  return response(true);
 }catch{return response(false)}
}
