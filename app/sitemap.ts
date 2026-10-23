import type {MetadataRoute} from 'next';
import {SITE_URL} from '@/lib/seo';
export default function sitemap():MetadataRoute.Sitemap{return [{url:SITE_URL+'/',changeFrequency:'daily',priority:1},{url:SITE_URL+'/about',changeFrequency:'monthly',priority:0.4},{url:SITE_URL+'/editorial-policy',changeFrequency:'monthly',priority:0.4}]}
