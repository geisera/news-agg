import './globals.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Curated News',description:'Topic-focused independent news aggregation'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}