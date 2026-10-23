import type {Article} from './db';

export type RankedArticle=Article&{relevance:number;significance:number;top_score:number;score:number;related:Article[];coverage:number};
const stop=new Set('a an and are as at be by for from has have in into is it its of on or over that the their this to was were will with after amid about says say said new latest live update updates report reports'.split(' '));
export function tokens(title:string):Set<string>{
 return new Set(title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(w=>w.length>2&&!stop.has(w)));
}
export function sameStory(a:string,b:string):boolean{
 const x=tokens(a),y=tokens(b);if(Math.min(x.size,y.size)<3)return false;
 const intersection=[...x].filter(t=>y.has(t)).length;
 const jaccard=intersection/(x.size+y.size-intersection);
 return jaccard>=0.62 && intersection>=3;
}
function domain(a:Article):string{try{return new URL(a.url).hostname.replace(/^www\./,'').toLowerCase()}catch{return a.source_name?.toLowerCase()||''}}
function freshness(date:string|null,now:number){const time=date?Date.parse(date):NaN;return Number.isFinite(time)?Math.max(0,100-Math.max(0,(now-time)/86400000)*7):0}
export function clusterAndRank(input:(Article&{relevance:number;significance:number;top_score:number})[],now=Date.now()):RankedArticle[]{
 const sorted=[...input].sort((a,b)=>(b.significance+b.relevance)-(a.significance+a.relevance));
 const groups:typeof sorted[]=[];
 for(const article of sorted){
  const group=groups.find(g=>g.some(other=>sameStory(other.title,article.title)));
  if(group)group.push(article);else groups.push([article]);
 }
 return groups.map(group=>{
  const domains=new Set(group.map(domain).filter(Boolean));
  const coverage=Math.min(100,Math.max(0,domains.size-1)*25);
  const rank=(a:typeof group[number])=>.4*a.relevance+.3*a.significance+.2*freshness(a.published_at,now)+.1*coverage;
  group.sort((a,b)=>rank(b)-rank(a));
  const lead=group[0];
  return {...lead,score:rank(lead),coverage,related:group.slice(1)};
 }).sort((a,b)=>b.score-a.score);
}
