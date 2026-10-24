import {NextRequest,NextResponse} from 'next/server';
import {isAdmin,auditAdmin} from '@/lib/auth';
import {db} from '@/lib/db';
import {reconcileStories} from '@/lib/story-store';
export const maxDuration=60;
export async function POST(req:NextRequest){if(!await isAdmin(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{const result=await reconcileStories(db(),80);await auditAdmin(req,'stories.reconcile');return NextResponse.json(result)}catch(e){return NextResponse.json({error:'Reconciliation failed',details:String(e)},{status:500})}}
