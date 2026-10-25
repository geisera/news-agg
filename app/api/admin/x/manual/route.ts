import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {isAdmin,auditAdmin} from '@/lib/auth';
import {publishDueXArticle} from '@/lib/x-publishing';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const search=(new URL(req.url).searchParams.get('q')||'').trim().slice(0,100);
 let query=db().from('stories').select('id,headline,canonical_article_id,last_updated_at').order('last_updated_at',{ascending:false}).limit(50);
 if(search)query=query.ilike('headline','%'+search.replace(/[%_,]/g,'')+'%');
 const {data,error}=await query;
 if(error)return NextResponse.json({error:error.message},{status:500});
 const ids=(data||[]).map(s=>s.canonical_article_id).filter(Boolean);
 const posts=ids.length?await db().from('x_article_posts').select('article_id,status,tweet_id').in('article_id',ids):{data:[],error:null};
 if(posts.error)return NextResponse.json({error:posts.error.message},{status:500});
 return NextResponse.json({stories:(data||[]).map(s=>({...s,xPost:(posts.data||[]).find(p=>p.article_id===s.canonical_article_id)||null}))},{headers:{'Cache-Control':'no-store'}});
}
const payload=z.object({articleId:z.string().uuid()});
export async function POST(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=payload.safeParse(await req.json().catch(()=>null));
 if(!body.success)return NextResponse.json({error:'Invalid article ID'},{status:400});
 try{
  const result=await publishDueXArticle(body.data.articleId);
  await auditAdmin(req,'x.article.manual_publish');
  return NextResponse.json(result,{status:result.status==='sent'?200:409,headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:String(e)},{status:409})}
}
