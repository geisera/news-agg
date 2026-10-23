import {sameStory} from '@/lib/stories';
type Client=ReturnType<typeof import('./db').db>;
function slug(title:string,id:string){return (title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,72)||'story')+'-'+id.slice(0,8)}
export async function assignStory(client:Client,article:{id:string;title:string;published_at:string|null}){
 const existing=await client.from('articles').select('story_id').eq('id',article.id).single();
 if(existing.error)throw existing.error;
 if(existing.data.story_id)return existing.data.story_id as string;
 const recent=await client.from('stories').select('id,headline,first_reported_at').order('last_updated_at',{ascending:false}).limit(400);
 if(recent.error)throw recent.error;
 const match=recent.data.find(s=>sameStory(s.headline,article.title));
 let storyId:string;
 if(match){storyId=match.id}
 else {
  const inserted=await client.from('stories').insert({slug:slug(article.title,article.id),headline:article.title,canonical_article_id:article.id,first_reported_at:article.published_at,last_updated_at:new Date().toISOString()}).select('id').single();
  if(inserted.error)throw inserted.error;
  storyId=inserted.data.id;
 }
 const attached=await client.from('articles').update({story_id:storyId}).eq('id',article.id);
 if(attached.error)throw attached.error;
 if(match){await client.from('stories').update({last_updated_at:new Date().toISOString()}).eq('id',storyId)}
 return storyId;
}
