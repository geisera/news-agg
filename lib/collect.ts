import {db} from '@/lib/db';
import {evaluate} from '@/lib/curate';
import {decodeHtmlEntities} from '@/lib/fetch';
import {assignStory} from '@/lib/story-store';
type NewsResult={title?:string;url?:string;description?:string;page_age?:string;profile?:{name?:string};thumbnail?:{src?:string;original?:string}};
export async function runCollection(){
 const client=db(),errors:string[]=[];
 const run=await client.from('collection_runs').insert({}).select('id').single();
 const site=await client.from('site_settings').select('*').eq('id',1).single();
 if(site.error)throw Error(site.error.message);
 const key=process.env.BRAVE_SEARCH_API_KEY;
 if(!key)throw Error('BRAVE_SEARCH_API_KEY is not configured in Vercel');
 const deadline=Date.now()+35000;
 const queries=String(site.data.search_queries||site.data.topic_description||'').split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean).slice(0,5);
 if(!queries.length)throw Error('Configure at least one search query');
 let discovered=0,evaluated=0,searches=0,resultsSeen=0;
 const limit=Math.max(1,Math.min(50,Number(site.data.search_result_limit)||20));
 const freshness=['pd','pw','pm','py'].includes(site.data.search_freshness)?site.data.search_freshness:'pw';
 for(const query of queries){
  if(Date.now()>deadline-15000)break;
  try{
   const params=new URLSearchParams({q:query.slice(0,400),count:String(limit),freshness,country:'US',search_lang:'en'});
   const res=await fetch('https://api.search.brave.com/res/v1/news/search?'+params,{
    headers:{Accept:'application/json','X-Subscription-Token':key},signal:AbortSignal.timeout(10000),cache:'no-store'});
   if(!res.ok){const body=await res.text();throw Error('Brave HTTP '+res.status+': '+body.slice(0,220))}
   const data=await res.json() as {results?:NewsResult[]};
   searches++;
   for(const item of data.results||[]){
    if(Date.now()>deadline-12000)break;
    resultsSeen++;
    if(!item.title||!item.url)continue;
    try{
     const link=new URL(item.url);
     if(!['https:','http:'].includes(link.protocol)||link.username||link.password)continue;
     const normalized=link.href;
     const title=decodeHtmlEntities(item.title).slice(0,500);
     const description=decodeHtmlEntities(item.description||'').replace(/<[^>]*>/g,' ').slice(0,1500);
     const domain=link.hostname.replace(/^www\./,'');
     const originalDate=item.page_age&&Number.isFinite(Date.parse(item.page_age))?new Date(item.page_age).toISOString():null;
     let thumb:string|null=null;
     try{const raw=item.thumbnail?.src||item.thumbnail?.original;if(raw){const u=new URL(raw);if(u.protocol==='https:'&&!u.username&&!u.password)thumb=u.href.slice(0,2000)}}catch{}
     const row={image_url:thumb,url:normalized,title,description,published_at:originalDate,source_name:(item.profile?.name||domain).slice(0,200),source_id:null,status:'review',image_allowed:false,search_discovered:true};
     const inserted=await client.from('articles').insert(row);
     if(inserted.error&&inserted.error.code!=='23505')throw Error(inserted.error.message);
     if(!inserted.error)discovered++;
    }catch(e){errors.push('Result: '+String(e))}
   }
  }catch(e){errors.push('Search: '+String(e))}
 }
 // Only new search-discovered items enter this queue; historical RSS backlog remains untouched.
 const pending=await client.from('articles').select('id,title,description,published_at').eq('search_discovered',true)
  .eq('status','review').is('evaluation_reason',null).order('created_at',{ascending:false}).limit(12);
 if(pending.error)errors.push('Queue: '+pending.error.message);
 for(const article of pending.data||[]){
  if(Date.now()>deadline-4000)break;
  try{
   const score=await evaluate(article.title,article.description||'',site.data);
   const age=article.published_at?Math.max(0,(Date.now()-Date.parse(article.published_at))/86400000):30;
   const topScore=.4*score.relevance+.3*score.significance+.2*Math.max(0,100-age*7);
   const saved=await client.from('articles').update({summary:score.summary,relevance:score.relevance,significance:score.significance,
    top_score:topScore,evaluation_reason:score.reason||'Evaluated',status:score.relevance>=(site.data.relevance_threshold??70)?'published':'review'}).eq('id',article.id);
   if(saved.error)throw Error(saved.error.message);
   if(score.relevance>=(site.data.relevance_threshold??70)){try{await assignStory(client,{id:article.id,title:article.title,published_at:article.published_at,description:article.description})}catch(e){errors.push('Story grouping: '+String(e))}}
   evaluated++;
  }catch(e){errors.push('AI evaluation: '+String(e));break}
 }
 const count=await client.from('articles').select('id',{count:'exact',head:true}).eq('search_discovered',true).eq('status','review').is('evaluation_reason',null);
 const pendingEvaluations=count.count||0;
 if(run.data)await client.from('collection_runs').update({finished_at:new Date().toISOString(),articles_created:discovered,errors}).eq('id',run.data.id);
 return {created:discovered,discovered,evaluated,pendingEvaluations,searches,resultsSeen,errors};
}
