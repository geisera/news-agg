import {NextRequest,NextResponse} from 'next/server';
import {isCron} from '@/lib/auth';
import {publishDueXArticle} from '@/lib/x-publishing';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
 if(!isCron(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{const result=await publishDueXArticle();return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})}
 catch(e){return NextResponse.json({status:'error',error:String(e)},{status:500})}
}
