import {queueXArticle} from '@/lib/x-publishing';
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
 const remaining=()=>deadline-Date.now();
 const threshold=site.data.relevance_threshold??70;
 const queries=String(site.data.search_queries||site.data.topic_description||'').split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean).slice(0,5);
 let discovered=0,evaluated=0,deleted=0,published=0,grouped=0,searches=0,resultsSeen=0;
 const pendingQuery=()=>client.from('articles').select('id,title,description,published_at').eq('search_discovered',true).eq('status','review').is('evaluation_reason',null).order('created_at',{ascending:true});
 const countBefore=await client.from('articles').select('id',{count:'exact',head:true}).eq('search_discovered',true).eq('status','review').is('evaluation_reason',null);
 if(countBefore.error)throw Error(countBefore.error.message);
 const queueBefore=countBefore.count||0;
 const calculateTop=(score:{relevance:number;significance:number},date:string|null)=>{
  const age=date?Math.max(0,(Date.now()-Date.parse(date))/86400000):30;
  return .4*score.relevance+.3*score.significance+.2*Math.max(0,100-age*7);
 };
 async function group(id:string,title:string,date:string|null,description:string|null){
  try{
   const storyId=await assignStory(client,{id,title,published_at:date,description});
   const story=await client.from('stories').select('canonical_article_id').eq('id',storyId).single();
   if(story.error)throw story.error;
   if(story.data.canonical_article_id!==id)grouped++;
  }catch(e){errors.push('Story grouping: '+String(e))}
 }
 // Clear the existing backlog first. Discovery never adds to the pending queue.
 const old=await pendingQuery().limit(20);
 if(old.error)throw Error(old.error.message);
 for(const article of old.data||[]){
  if(remaining()<12000)break;
  try{
   const score=await evaluate(article.title,article.description||'',site.data);
   if(score.relevance<threshold){
    const removed=await client.from('articles').delete().eq('id',article.id);
    if(removed.error)throw removed.error;
    deleted++;
   }else{
    const saved=await client.from('articles').update({summary:score.summary,relevance:score.relevance,significance:score.significance,top_score:calculateTop(score,article.published_at),evaluation_reason:score.reason||'Evaluated',status:'published'}).eq('id',article.id);
    if(saved.error)throw saved.error;
    published++;await group(article.id,article.title,article.published_at,article.description);await queueXArticle(article.id);
   }
   evaluated++;
  }catch(e){errors.push('Evaluation: '+String(e));break}
 }
 const backlog=await client.from('articles').select('id',{count:'exact',head:true}).eq('search_discovered',true).eq('status','review').is('evaluation_reason',null);
 if(backlog.error)throw Error(backlog.error.message);
 const discoveryPaused=(backlog.count||0)>0;
 const limit=Math.max(1,Math.min(50,Number(site.data.search_result_limit)||20));
 const freshness=['pd','pw','pm','py'].includes(site.data.search_freshness)?site.data.search_freshness:'pw';
 // Admit at most 20 new distinct candidates. Evaluate before inserting: no unevaluated records are created.
 if(!discoveryPaused&&queries.length){
  let stop=false;
  for(const query of queries){
   if(stop||remaining()<17000||discovered>=20)break;
   try{
    const params=new URLSearchParams({q:query.slice(0,400),count:String(limit),freshness,country:'US',search_lang:'en'});
    const res=await fetch('https://api.search.brave.com/res/v1/news/search?'+params,{headers:{Accept:'application/json','X-Subscription-Token':key},signal:AbortSignal.timeout(9000),cache:'no-store'});
    if(!res.ok)throw Error('Brave HTTP '+res.status+': '+(await res.text()).slice(0,200));
    const data=await res.json() as {results?:NewsResult[]};
    searches++;
    for(const item of data.results||[]){
     if(discovered>=20||remaining()<12000){stop=true;break}
     resultsSeen++;
     if(!item.title||!item.url)continue;
     try{
      const link=new URL(item.url);
      if(!['https:','http:'].includes(link.protocol)||link.username||link.password)continue;
      const url=link.href;
      const existing=await client.from('articles').select('id').eq('url',url).maybeSingle();
      if(existing.error)throw existing.error;
      if(existing.data)continue;
      const title=decodeHtmlEntities(item.title).slice(0,500);
      const description=decodeHtmlEntities(item.description||'').replace(/<[^>]*>/g,' ').slice(0,1500);
      const date=item.page_age&&Number.isFinite(Date.parse(item.page_age))?new Date(item.page_age).toISOString():null;
      // Evaluate first; only passing articles enter the database.
      const score=await evaluate(title,description,site.data);
      discovered++;evaluated++;
      if(score.relevance<threshold){deleted++;continue}
      let image_url:string|null=null;
      try{const raw=item.thumbnail?.src||item.thumbnail?.original;if(raw){const u=new URL(raw);if(u.protocol==='https:'&&!u.username&&!u.password)image_url=u.href.slice(0,2000)}}catch{}
      const row={url,title,description,published_at:date,source_name:(item.profile?.name||link.hostname.replace(/^www\./,'')).slice(0,200),source_id:null,status:'published',summary:score.summary,relevance:score.relevance,significance:score.significance,top_score:calculateTop(score,date),evaluation_reason:score.reason||'Evaluated',image_url,image_allowed:false,search_discovered:true};
      const inserted=await client.from('articles').insert(row).select('id').single();
      if(inserted.error){if(inserted.error.code!=='23505')throw inserted.error;continue}
      published++;await group(inserted.data.id,title,date,description);await queueXArticle(inserted.data.id);
     }catch(e){errors.push('Candidate: '+String(e));if(String(e).includes('AI HTTP')){stop=true;break}}
    }
   }catch(e){errors.push('Search: '+String(e))}
  }
 }
 const count=await client.from('articles').select('id',{count:'exact',head:true}).eq('search_discovered',true).eq('status','review').is('evaluation_reason',null);
 const pendingEvaluations=count.count||0;
 if(run.data)await client.from('collection_runs').update({finished_at:new Date().toISOString(),articles_created:discovered,errors}).eq('id',run.data.id);
 return {created:discovered,discovered,evaluated,deleted,published,grouped,pendingEvaluations,queueBefore,discoveryPaused,searches,resultsSeen,errors};
}
