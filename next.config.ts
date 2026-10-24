import type {NextConfig} from 'next';
const nextConfig:NextConfig={async headers(){return [{source:'/admin',headers:[{key:'Cache-Control',value:'private, no-store, max-age=0'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]},{source:'/api/admin/:path*',headers:[{key:'Cache-Control',value:'private, no-store, max-age=0'}]}]}};
export default nextConfig;
