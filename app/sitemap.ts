import type {MetadataRoute} from 'next';
import {SITE_URL} from '@/lib/seo';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 const entries:MetadataRoute.Sitemap=[{url:SITE_URL+'/',changeFrequency:'daily',priority:1},{url:SITE_URL+'/about',changeFrequency:'monthly',priority:0.4},{url:SITE_URL+'/editorial-policy',changeFrequency:'monthly',priority:0.4}];
 try{const r=await db().from('stories').select('id,last_updated_at').order('last_updated_at',{ascending:false}).limit(10000);if(!r.error&&r.data)for(const s of r.data)entries.push({url:SITE_URL+'/stories/'+s.id,lastModified:s.last_updated_at,changeFrequency:'weekly',priority:0.7})}catch{}
 return entries;
}
