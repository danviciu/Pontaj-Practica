import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

function formatRate(value) {
    if (!Number.isFinite(value)) return '0%';
    return `${value.toFixed(1)}%`;
}

function MetricsCards({ summary }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
                <CardContent className="pt-4">
                    <p className="text-xs text-gray-500">Pontaje Planificate</p>
                    <p className="text-2xl font-bold">{summary.expected}</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="pt-4">
                    <p className="text-xs text-gray-500">Prezente</p>
                    <p className="text-2xl font-bold text-green-600">{summary.present}</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="pt-4">
                    <p className="text-xs text-gray-500">Absente</p>
                    <p className="text-2xl font-bold text-red-600">{summary.absent}</p>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="pt-4">
                    <p className="text-xs text-gray-500">Rata Prezenta</p>
                    <p className="text-2xl font-bold text-blue-600">{formatRate(summary.rate)}</p>
                </CardContent>
            </Card>
        </div>
    );
}

function GroupTable({ title, rows }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nume</TableHead>
                            <TableHead className="text-right">Planificate</TableHead>
                            <TableHead className="text-right">Prezente</TableHead>
                            <TableHead className="text-right">Absente</TableHead>
                            <TableHead className="text-right">Pending</TableHead>
                            <TableHead className="text-right">Rata</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.name}>
                                <TableCell className="font-medium">{row.name}</TableCell>
                                <TableCell className="text-right">{row.expected}</TableCell>
                                <TableCell className="text-right text-green-700">{row.present}</TableCell>
                                <TableCell className="text-right text-red-700">{row.absent}</TableCell>
                                <TableCell className="text-right text-amber-700">{row.pending}</TableCell>
                                <TableCell className="text-right">{formatRate(row.rate)}</TableCell>
                            </TableRow>
                        ))}
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                                    Fara date pentru filtrele selectate.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

export default function DashboardKpiReport({
    reportRangeLabel,
    summary,
    byClass,
    byOperator,
    onExportCsv,
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                        <CardTitle>Raport KPI Prezenta</CardTitle>
                        <Badge variant="outline">{reportRangeLabel}</Badge>
                    </div>
                    <Button variant="outline" onClick={onExportCsv}>
                        <Download className="h-4 w-4 mr-2" />
                        Export KPI CSV
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <MetricsCards summary={summary} />
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <GroupTable title="KPI pe Clase" rows={byClass} />
                    <GroupTable title="KPI pe Operatori" rows={byOperator} />
                </div>
            </CardContent>
        </Card>
    );
}
