import type {Metadata} from 'next';
import Admin from './ui';
export const metadata:Metadata={title:'Administration | News Agg',robots:{index:false,follow:false}};
export default function AdminPage(){return <Admin/>}
