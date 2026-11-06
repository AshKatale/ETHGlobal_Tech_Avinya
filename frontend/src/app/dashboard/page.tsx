import { Suspense } from 'react';
import Dashboard from './Dashboard';

export const metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return <Suspense fallback={<div className="page"><div className="container"><div className="skel" style={{ height: 300 }} /></div></div>}><Dashboard /></Suspense>;
}
