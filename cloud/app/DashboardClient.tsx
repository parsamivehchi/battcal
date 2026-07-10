'use client';
// Client host for the shared BattCal dashboard SPA (../dashboard/src/App). Mounted
// client-only (the SPA touches window/localStorage) with the read-only cloud data
// source: reads go to this app's own /battcal/api/* routes (Supabase-backed); control
// methods are absent from the source AND this app ships no control routes.
import dynamic from 'next/dynamic';
import { cloudDataSource } from '../../dashboard/src/data/data-source';

const App = dynamic(() => import('../../dashboard/src/App'), { ssr: false });

const source = cloudDataSource('/battcal');

export default function DashboardClient() {
  return <App source={source} basename="/battcal" signoutAction="/battcal/auth/signout" />;
}
