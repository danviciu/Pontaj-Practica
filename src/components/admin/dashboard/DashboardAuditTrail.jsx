import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';

function formatTimestamp(value) {
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return '-';
    return format(dateValue, 'dd MMM yyyy, HH:mm', { locale: ro });
}

function actionBadgeVariant(action) {
    if (String(action).includes('DELETE')) return 'destructive';
    if (String(action).includes('UPDATE')) return 'secondary';
    if (String(action).includes('CREATE')) return 'default';
    return 'outline';
}

export default function DashboardAuditTrail({ logs = [] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Audit Trail (ultimele actiuni)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Actor</TableHead>
                            <TableHead>Actiune</TableHead>
                            <TableHead>Entitate</TableHead>
                            <TableHead>Detalii</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logs.map((logItem) => (
                            <TableRow key={logItem.id}>
                                <TableCell className="whitespace-nowrap">{formatTimestamp(logItem.timestamp)}</TableCell>
                                <TableCell>{logItem.actorName || logItem.actorEmail || 'Sistem'}</TableCell>
                                <TableCell>
                                    <Badge variant={actionBadgeVariant(logItem.action)}>{logItem.action}</Badge>
                                </TableCell>
                                <TableCell>
                                    {logItem.entityType}
                                    {logItem.entityId ? ` (${logItem.entityId})` : ''}
                                </TableCell>
                                <TableCell className="text-sm text-gray-600">{logItem.details || '-'}</TableCell>
                            </TableRow>
                        ))}
                        {logs.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                                    Nu exista inca evenimente de audit.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
