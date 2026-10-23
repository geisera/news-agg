import {NextRequest,NextResponse} from 'next/server';
import {isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {safeUrl,fetchSafe,itemsFromFeed} from '@/lib/fetch';
import {z} from 'zod';

const schema=z.object({urls:z.array(z.string().trim().min(1).max(2048)).min(1).max(30)});
export const maxDuration=60;
export async function POST(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const parsed=schema.safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Provide 1–30 feed URLs'},{status:400});
 const client=db(),results:{url:string;status:'added'|'duplicate'|'invalid';detail?:string}[]=[];
 const seen=new Set<string>();
 for(const raw of parsed.data.urls){
  try{
   const input=(await safeUrl(raw)).href;
   if(seen.has(input)){results.push({url:raw,status:'duplicate'});continue}
   seen.add(input);
   const fetched=await fetchSafe(input);
   const entries=itemsFromFeed(fetched.body);
   if(!entries.length)throw Error('Feed contains no articles');
   const existing=await client.from('sources').select('id').eq('feed_url',fetched.url).maybeSingle();
   if(existing.error)throw Error(existing.error.message);
   if(existing.data){results.push({url:raw,status:'duplicate'});continue}
   const name=new URL(fetched.url).hostname.slice(0,200);
   const added=await client.from('sources').insert({feed_url:fetched.url,name});
   if(added.error){if(added.error.code==='23505'){results.push({url:raw,status:'duplicate'});continue}throw Error(added.error.message)}
   results.push({url:raw,status:'added'});
  }catch(e){results.push({url:raw,status:'invalid',detail:String(e).slice(0,200)})}
 }
 return NextResponse.json({results,added:results.filter(r=>r.status==='added').length,duplicates:results.filter(r=>r.status==='duplicate').length,failed:results.filter(r=>r.status==='invalid').length});
}
