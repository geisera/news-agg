import {notFound,redirect} from 'next/navigation';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
export default async function StoryRedirect({params}:Params){
 const {id}=await params;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound();
 const client=db();
 const {data:story,error}=await client.from('stories').select('canonical_article_id').eq('id',id).maybeSingle();
 if(error||!story)notFound();
 let url:string|undefined;
 if(story.canonical_article_id){
  const canonical=await client.from('articles').select('url').eq('id',story.canonical_article_id).eq('status','published').maybeSingle();
  url=canonical.data?.url;
 }
 if(!url){
  const fallback=await client.from('articles').select('url').eq('story_id',id).eq('status','published').order('published_at',{ascending:false}).limit(1).maybeSingle();
  url=fallback.data?.url;
 }
 if(!url)notFound();
 try{const target=new URL(url);if(target.protocol!=='https:'&&target.protocol!=='http:')notFound()}catch{notFound()}
 redirect(url);
}
