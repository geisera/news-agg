import type {Metadata} from 'next';
export const SITE_URL='https://news-agg-bookfic.vercel.app';
export function description(text:string){const clean=text.replace(/\s+/g,' ').trim();return clean.length>160?clean.slice(0,157).replace(/\s+\S*$/,'')+'…':clean||'Independent, source-attributed news coverage and editorial summaries.'}
export function siteMetadata({title,description:body,canonical='/',robots}:{title:string;description:string;canonical?:string;robots?:Metadata['robots']}):Metadata{
 const summary=description(body);
 return {title,description:summary,alternates:{canonical},robots,openGraph:{type:'website',url:canonical,title,description:summary,siteName:'Omar Watch'},twitter:{card:'summary',title,description:summary}};
}
