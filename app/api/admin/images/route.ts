import {NextRequest,NextResponse} from 'next/server';
import {isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {z} from 'zod';
const change=z.object({id:z.string().uuid(),approved:z.boolean()});
export async function GET(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const r=await db().from('articles').select('id,title,image_url,image_allowed,source_name').eq('status','published').not('image_url','is',null).order('created_at',{ascending:false}).limit(60);
 return r.error?NextResponse.json({error:r.error.message},{status:500}):NextResponse.json({images:r.data});
}
export async function PATCH(req:NextRequest){
 if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 const parsed=change.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid approval request'},{status:400});
 const r=await db().from('articles').update({image_allowed:parsed.data.approved}).eq('id',parsed.data.id).not('image_url','is',null);
 return r.error?NextResponse.json({error:r.error.message},{status:500}):NextResponse.json({ok:true});
}
