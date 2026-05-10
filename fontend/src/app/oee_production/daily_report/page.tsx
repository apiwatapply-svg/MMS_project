'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ReportDashboard from '../components/ReportDashboard';

function DailyReportContent() {
    const searchParams = useSearchParams();
    const machineName = searchParams.get('machine') || '';
    return <ReportDashboard mode="daily" initialMachine={machineName} />;
}

export default function DailyReportPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <DailyReportContent />
        </Suspense>
    );
}
