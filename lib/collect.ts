import {db} from '@/lib/db';
import {fetchSafe,itemsFromFeed,safeUrl} from '@/lib/fetch';
import {evaluate} from '@/lib/curate';

// Discovery and evaluation are independent: new items persist as review/unevaluated.
export async function runCollection(){
 const client=db();
 const run=await client.from('collection_runs').insert({}).select('id').single();
 const errors:string[]=[];
 let created=0,evaluated=0,processedSources=0;
 const deadline=Date.now()+35000;
 const timeLeft=()=>Date.now()<deadline;
 const site=await client.from('site_settings').select('*').eq('id',1).single();
 if(site.error)throw Error(site.error.message);
 const feeds=await client.from('sources').select('*',{count:'exact'}).eq('enabled',true)
  .order('last_checked_at',{ascending:true,nullsFirst:true}).order('id',{ascending:true}).limit(5);
 if(feeds.error)throw Error(feeds.error.message);
 const totalSources=feeds.count||0;
 let discovered=0;
 for(const source of feeds.data||[]){
  if(!timeLeft())break;
  processedSources++;
  try{
   const response=await fetchSafe(source.feed_url);
   const entries=itemsFromFeed(response.body); // Parser bounds feed to 100 entries.
   for(const item of entries){
    if(!timeLeft())break;
    try{
     const url=(await safeUrl(new URL(item.url,response.url).href)).href;
     const previous=await client.from('articles').select('id').eq('url',url).maybeSingle();
     if(previous.error)throw Error(previous.error.message);
     if(previous.data)continue;
     const date=item.date&&Number.isFinite(Date.parse(item.date))?new Date(item.date).toISOString():null;
     const inserted=await client.from('articles').insert({
      source_id:source.id,title:item.title,url,description:item.description,published_at:date,
      image_url:item.image,image_allowed:Boolean(source.image_license_ok),status:'review'
     });
     if(inserted.error){if(inserted.error.code!=='23505')throw Error(inserted.error.message)}
     else{created++;discovered++}
    }catch(e){errors.push('Article: '+String(e))}
   }
   // Only advance source cursor if all items could be considered.
   if(timeLeft())await client.from('sources').update({last_checked_at:new Date().toISOString(),last_error:null}).eq('id',source.id);
  }catch(e){
   errors.push(source.name+': '+String(e));
   await client.from('sources').update({last_checked_at:new Date().toISOString(),last_error:String(e)}).eq('id',source.id);
  }
 }
 // AI processing consumes the remaining request budget; queue is persistent.
 const maxEvaluations=12;
 if(timeLeft()){
  const pending=await client.from('articles').select('id,title,description,published_at')
   .eq('status','review').is('evaluation_reason',null).order('created_at',{ascending:true}).limit(maxEvaluations);
  if(pending.error)errors.push('Pending lookup: '+pending.error.message);
  for(const article of pending.data||[]){
   if(!timeLeft())break;
   try{
    const assessment=await evaluate(article.title,article.description||'',site.data);
    const threshold=site.data?.relevance_threshold??70;
    const age=article.published_at?Math.max(0,(Date.now()-new Date(article.published_at).getTime())/86400000):30;
    const score=.4*assessment.relevance+.3*assessment.significance+.2*Math.max(0,100-age*7);
    const updated=await client.from('articles').update({
     summary:assessment.summary,relevance:assessment.relevance,significance:assessment.significance,
     top_score:score,evaluation_reason:assessment.reason||'Evaluated',
     status:assessment.relevance>=threshold?'published':'review'
    }).eq('id',article.id);
    if(updated.error)throw Error(updated.error.message);
    evaluated++;
   }catch(e){errors.push('Evaluation: '+String(e));break}
  }
 }
 const queue=await client.from('articles').select('id',{count:'exact',head:true})
  .eq('status','review').is('evaluation_reason',null);
 if(queue.error)errors.push('Queue count: '+queue.error.message);
 const pendingEvaluations=queue.count||0;
 if(run.data){
  const done=await client.from('collection_runs').update({
   finished_at:new Date().toISOString(),articles_created:created,errors
  }).eq('id',run.data.id);
  if(done.error)errors.push('Run status: '+done.error.message);
 }
 return {created,discovered,evaluated,pendingEvaluations,processedSources,totalSources,
  remainingSources:Math.max(0,totalSources-processedSources),stoppedEarly:!timeLeft(),errors};
}
