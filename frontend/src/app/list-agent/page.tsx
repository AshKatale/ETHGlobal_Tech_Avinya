import { Suspense } from 'react';
import ListAgentWizard from './Wizard';

export const metadata = { title: 'List an agent' };

export default function ListAgentPage() {
  return <Suspense fallback={<div className="page"><div className="container"><div className="skel" style={{ height: 300 }} /></div></div>}><ListAgentWizard /></Suspense>;
}
