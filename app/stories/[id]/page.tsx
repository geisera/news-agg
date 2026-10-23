import Link from 'next/link';
import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {db,publisher,type Article} from '@/lib/db';
import {SITE_URL,description} from '@/lib/seo';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
async function load(id:string){
 const client=db();
 const result=await client.from('stories').select('id,slug,headline,canonical_article_id,first_reported_at,last_updated_at').eq('id',id).maybeSingle();
 if(result.error||!result.data)return null;
 const related=await client.from('articles').select('id,story_id,title,url,summary,description,published_at,source_name,image_url,image_allowed,source:sources(name),status').eq('story_id',id).eq('status','published').limit(100);
 if(related.error||!related.data?.length)return null;
 return {story:result.data,articles:related.data as unknown as (Article&{description:string|null})[]};
}
export async function generateMetadata({params}:Params):Promise<Metadata>{
 const {id}=await params;const data=await load(id);if(!data)return {title:'Story not found',robots:{index:false}};
 const main=data.articles.find(a=>a.id===data.story.canonical_article_id)||data.articles[0];
 const url='/stories/'+id;
 const title=data.story.headline;
 const summary=description(main.summary||main.description||'Related news coverage from attributed publishers.');
 return {title,description:summary,alternates:{canonical:url},openGraph:{type:'article',url,title,description:summary,publishedTime:data.story.first_reported_at||undefined,modifiedTime:data.story.last_updated_at},twitter:{card:'summary',title,description:summary}};
}
export default async function StoryPage({params}:Params){
 const {id}=await params;const data=await load(id);if(!data)notFound();
 const {story,articles}=data;const primary=articles.find(a=>a.id===story.canonical_article_id)||articles[0];const additional=articles.filter(a=>a.id!==primary.id && a.url!==primary.url);
 const jsonld={'@context':'https://schema.org','@type':'WebPage',name:story.headline,url:SITE_URL+'/stories/'+story.id,description:description(primary.summary||primary.description||''),dateModified:story.last_updated_at,about:{'@type':'Thing',name:story.headline},mainEntity:{'@type':'ItemList',itemListElement:articles.map((a,i)=>({'@type':'ListItem',position:i+1,url:a.url,name:a.title}))}};
 return <><header><div className="wrap mast"><Link className="brand" href="/">News Agg</Link><Link href="/">Latest News</Link></div></header><main className="wrap content-page"><nav aria-label="Breadcrumb"><Link href="/">News</Link> / Story</nav><article><h1><a href={primary.url} target="_blank" rel="noopener noreferrer">{story.headline}</a></h1><p className="meta">First reported: {story.first_reported_at?new Date(story.first_reported_at).toLocaleDateString('en-US'):'Date unavailable'} · Coverage from {new Set(articles.map(a=>publisher(a))).size} publishers</p>{primary.image_allowed&&primary.image_url&&<a href={primary.url} target="_blank" rel="noopener noreferrer"><img className="story-hero" src={primary.image_url} alt="" width={720} height={405} loading="lazy" referrerPolicy="no-referrer"/></a>}{primary.summary?<p>{primary.summary}</p>:primary.description?<p>{primary.description}</p>:<p>Read the original publisher's reporting for more information.</p>}<p><a href={primary.url} target="_blank" rel="noopener noreferrer">Read original report — {publisher(primary)} ↗</a></p>{additional.length>0&&<><h2>Related coverage</h2><ul>{additional.map(a=><li key={a.id}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> — {publisher(a)}</li>)}</ul></>}<p className="meta">Linked reporting belongs to the original publishers. Allegations are not findings of guilt.</p></article><p><Link href="/">← Latest News</Link></p></main><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(jsonld).replace(/</g,'\\u003c')}}/></>;
}
