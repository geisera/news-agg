import './globals.css';
import type {Metadata} from 'next';
import {SITE_URL} from '@/lib/seo';
export const metadata:Metadata={metadataBase:new URL(SITE_URL),title:{default:'Omar Watch | Curated News',template:'%s'},description:'Independent, source-attributed news and AI-assisted summaries.',applicationName:'Omar Watch',openGraph:{type:'website',siteName:'Omar Watch',locale:'en_US'},twitter:{card:'summary'},robots:{index:true,follow:true}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
