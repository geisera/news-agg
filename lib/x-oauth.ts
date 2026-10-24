import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {db} from '@/lib/db';
export const callback='https://omarreport.com/api/auth/x/callback';
const clientId=()=>{if(!process.env.X_CLIENT_ID)throw Error('Missing X_CLIENT_ID');return process.env.X_CLIENT_ID};
const encryptionKey=()=>{const s=process.env.X_TOKEN_ENCRYPTION_KEY;if(!s||!/^[a-f0-9]{64}$/i.test(s))throw Error('X_TOKEN_ENCRYPTION_KEY must be 64 hex characters');return Buffer.from(s,'hex')};
export const random=()=>randomBytes(32).toString('base64url');
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function encrypt(text:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64')}
export function decrypt(value:string){const buffer=Buffer.from(value,'base64');const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),buffer.subarray(0,12));decipher.setAuthTag(buffer.subarray(12,28));return Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString('utf8')}
export const challenge=(verifier:string)=>createHash('sha256').update(verifier).digest('base64url');
type Tokens={access_token:string;refresh_token?:string;expires_in:number};
export async function exchange(form:URLSearchParams):Promise<Tokens>{
 const secret=process.env.X_CLIENT_SECRET;
 const auth=secret?'Basic '+Buffer.from(clientId()+':'+secret).toString('base64'):undefined;
 if(!secret)form.set('client_id',clientId());
 const response=await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(auth?{Authorization:auth}:{})},body:form.toString(),cache:'no-store',signal:AbortSignal.timeout(12000)});
 const json=await response.json().catch(()=>({}));
 if(!response.ok||!json.access_token)throw Error('X token exchange failed (HTTP '+response.status+'): '+String(json.error||json.detail||'Unknown').slice(0,140));
 return json as Tokens;
}
export async function storeTokens(tokens:Tokens,username?:string){
 if(!tokens.refresh_token)throw Error('X did not return a refresh token. Verify offline.access scope.');
 const result=await db().from('x_oauth_connection').upsert({id:1,access_cipher:encrypt(tokens.access_token),refresh_cipher:encrypt(tokens.refresh_token),expires_at:new Date(Date.now()+Math.max(60,tokens.expires_in-60)*1000).toISOString(),username:username||null,updated_at:new Date().toISOString()});
 if(result.error)throw result.error;
}
export async function currentXToken(){
 const client=db();
 const connection=await client.from('x_oauth_connection').select('*').eq('id',1).maybeSingle();
 if(connection.error)throw connection.error;
 if(!connection.data)throw Error('Connect an X account in Admin first.');
 if(new Date(connection.data.expires_at).getTime()>Date.now()+15000)return decrypt(connection.data.access_cipher);
 const tokens=await exchange(new URLSearchParams({grant_type:'refresh_token',refresh_token:decrypt(connection.data.refresh_cipher)}));
 await storeTokens(tokens,connection.data.username);
 return tokens.access_token;
}
export const xClientId=clientId;
