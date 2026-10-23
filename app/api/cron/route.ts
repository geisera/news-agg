import {NextRequest,NextResponse} from 'next/server';
import {isCron} from '@/lib/auth';
import {runCollection} from '@/lib/collect';
export const maxDuration=60;
export async function GET(req:NextRequest){if(!isCron(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{return NextResponse.json(await runCollection())}catch(e){return NextResponse.json({error:'Collection failed',details:String(e)},{status:500})}}
