import {NextRequest,NextResponse} from 'next/server';
import {isAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
export async function POST(req:NextRequest){if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});const client=db();const result=await client.from('articles').update({status:'review',evaluation_reason:null}).eq('search_discovered',true).neq('status','rejected').select('id');if(result.error)return NextResponse.json({error:result.error.message},{status:500});return NextResponse.json({queued:result.data?.length||0})}
