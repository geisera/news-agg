import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {isAdmin,auditAdmin} from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const client=db();
 const [settings,posts]=await Promise.all([client.from('x_settings').select('enabled,daily_limit').eq('id',1).single(),client.from('x_posts').select('story_id,status,tweet_id,attempts,last_error,created_at,updated_at').order('created_at',{ascending:false}).limit(50)]);
 if(settings.error||posts.error)return NextResponse.json({error:settings.error?.message||posts.error?.message},{status:500});
 return NextResponse.json({settings:settings.data,posts:posts.data,configured:Boolean(process.env.X_USER_ACCESS_TOKEN)},{headers:{'Cache-Control':'no-store'}});
}
const schema=z.object({enabled:z.boolean(),daily_limit:z.number().int().min(0).max(50)});
export async function PUT(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=schema.safeParse(await req.json().catch(()=>null));
 if(!body.success)return NextResponse.json({error:'Invalid settings'},{status:400});
 if(body.data.enabled&&!process.env.X_USER_ACCESS_TOKEN)return NextResponse.json({error:'Configure X_USER_ACCESS_TOKEN in Vercel before enabling.'},{status:400});
 const result=await db().from('x_settings').update({...body.data,updated_at:new Date().toISOString()}).eq('id',1);
 if(result.error)return NextResponse.json({error:result.error.message},{status:500});
 await auditAdmin(req,'x.settings.update');
 return NextResponse.json({ok:true});
}
