import {db} from '@/lib/db';
export async function queueXStory(storyId:string){
 const client=db();
 const setting=await client.from('x_settings').select('enabled').eq('id',1).single();
 if(setting.error||!setting.data?.enabled)return;
 const r=await client.from('x_posts').upsert({story_id:storyId,status:'pending'},{onConflict:'story_id',ignoreDuplicates:true});
 if(r.error)throw r.error;
}
export async function publishQueuedXPost(){
 const client=db();
 if(!process.env.X_USER_ACCESS_TOKEN)return {status:'not_configured'};
 const claim=await client.rpc('claim_x_post');
 if(claim.error)throw claim.error;
 const storyId=claim.data as string|null;
 if(!storyId)return {status:'idle'};
 const story=await client.from('stories').select('headline,canonical_article_id').eq('id',storyId).single();
 if(story.error||!story.data){
  await client.from('x_posts').update({status:'failed',last_error:'Story is unavailable',updated_at:new Date().toISOString()}).eq('story_id',storyId);
  return {status:'failed'};
 }
 const headline=String(story.data.headline).replace(/\s+/g,' ').trim();
 const text=headline.slice(0,230).trim()+'\n\nhttps://omarreport.com/';
 try{
  const response=await fetch('https://api.x.com/2/tweets',{method:'POST',headers:{Authorization:'Bearer '+process.env.X_USER_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(12000),cache:'no-store'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload?.data?.id)throw Error('X API HTTP '+response.status+': '+JSON.stringify(payload).slice(0,300));
  const saved=await client.from('x_posts').update({status:'sent',tweet_id:String(payload.data.id),last_error:null,updated_at:new Date().toISOString()}).eq('story_id',storyId);
  if(saved.error)throw saved.error;
  return {status:'sent',storyId};
 }catch(error){
  // An ambiguous network failure might mean X accepted the post. Require review, never blind retry.
  await client.from('x_posts').update({status:'review',last_error:String(error).slice(0,500),updated_at:new Date().toISOString()}).eq('story_id',storyId);
  return {status:'review',storyId};
 }
}
