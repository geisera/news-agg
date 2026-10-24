import {NextRequest,NextResponse} from 'next/server';
import {isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const client=db();
 const [articles,stories,runs]=await Promise.all([
  client.from('articles').select('id',{count:'exact',head:true}),
  client.from('stories').select('id',{count:'exact',head:true}),
  client.from('collection_runs').select('id',{count:'exact',head:true})
 ]);
 if(articles.error||stories.error||runs.error)return NextResponse.json({error:'Unable to count content before purge'},{status:500});
 return NextResponse.json({articles:articles.count||0,stories:stories.count||0,collectionRuns:runs.count||0});
}
export async function POST(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]||'';
 try{const payload=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString('utf8'));if(!payload.auth_time||Date.now()/1000-payload.auth_time>900)return NextResponse.json({error:'Reauthentication required before purge'},{status:403});}catch{return NextResponse.json({error:'Invalid session'},{status:403})}
 const body=await req.json().catch(()=>null);
 if(body?.confirmation!=='PURGE')return NextResponse.json({error:'Type PURGE to confirm permanent deletion'},{status:400});
 const {data,error}=await db().rpc('purge_news_content');
 if(error)return NextResponse.json({error:'Purge failed',details:error.message},{status:500});
 return NextResponse.json(data);
}
