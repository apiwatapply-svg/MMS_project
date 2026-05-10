'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ReportDashboard from '../components/ReportDashboard';

function MonthlyReportContent() {
    const searchParams = useSearchParams();
    const machineName = searchParams.get('machine') || '';
    return <ReportDashboard mode="monthly" initialMachine={machineName} />;
}

export default function MonthlyReportPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <MonthlyReportContent />
        </Suspense>
    );
}
