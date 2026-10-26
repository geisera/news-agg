import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {isAdmin,auditAdmin} from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const client=db();
 const [settings,posts,connection]=await Promise.all([client.from('x_settings').select('enabled,daily_limit').eq('id',1).single(),client.from('x_article_posts').select('article_id,status,tweet_id,attempts,last_error,created_at,updated_at').order('created_at',{ascending:false}).limit(50),client.from('x_oauth_connection').select('username,expires_at').eq('id',1).maybeSingle()]);
 if(settings.error||posts.error)return NextResponse.json({error:settings.error?.message||posts.error?.message},{status:500});
 const articleIds=(posts.data||[]).map(p=>p.article_id);
 const articles=articleIds.length?await client.from('articles').select('id,title').in('id',articleIds):{data:[],error:null};
 if(articles.error)return NextResponse.json({error:articles.error.message},{status:500});
 const titles=new Map((articles.data||[]).map(a=>[a.id,a.title]));
 const titledPosts=(posts.data||[]).map(p=>({...p,article_title:titles.get(p.article_id)||'Article unavailable'}));
 return NextResponse.json({settings:settings.data,posts:titledPosts,configured:Boolean(connection.data),username:connection.data?.username||null},{headers:{'Cache-Control':'no-store'}});
}
const schema=z.object({enabled:z.boolean(),daily_limit:z.number().int().min(0).max(5)});
export async function PUT(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=schema.safeParse(await req.json().catch(()=>null));
 if(!body.success)return NextResponse.json({error:'Invalid settings'},{status:400});
 if(body.data.enabled&&!(await db().from('x_oauth_connection').select('id').eq('id',1).maybeSingle()).data)return NextResponse.json({error:'Connect an X account before enabling posting.'},{status:400});
 const result=await db().from('x_settings').update({...body.data,updated_at:new Date().toISOString()}).eq('id',1);
 if(result.error)return NextResponse.json({error:result.error.message},{status:500});
 await auditAdmin(req,'x.settings.update');
 return NextResponse.json({ok:true});
}

export async function DELETE(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const client=db();
 const reset=await client.from('x_settings').update({enabled:false,updated_at:new Date().toISOString()}).eq('id',1);
 if(reset.error)return NextResponse.json({error:reset.error.message},{status:500});
 const result=await client.from('x_oauth_connection').delete().eq('id',1);
 if(result.error)return NextResponse.json({error:result.error.message},{status:500});
 await auditAdmin(req,'x.account.disconnect');
 return NextResponse.json({ok:true});
}
