import { Suspense } from 'react';
import PostJob from './PostJob';

export const metadata = { title: 'Post a job' };

export default function PostJobPage() {
  return <Suspense fallback={<div className="page"><div className="container"><div className="skel" style={{ height: 300 }} /></div></div>}><PostJob /></Suspense>;
}
