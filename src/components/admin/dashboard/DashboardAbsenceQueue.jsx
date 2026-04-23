import React from 'react';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

function formatTimestamp(value) {
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return '-';
    return format(dateValue, 'dd MMM yyyy, HH:mm', { locale: ro });
}

export default function DashboardAbsenceQueue({
    notes,
    isApplyingId,
    onApplyJustification,
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Scuze elevi (absente raportate)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Trimis la</TableHead>
                            <TableHead>Elev</TableHead>
                            <TableHead>Data absenta</TableHead>
                            <TableHead>Mesaj</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actiune</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {notes.map((note) => (
                            <TableRow key={note.id}>
                                <TableCell className="whitespace-nowrap">{formatTimestamp(note.timestamp)}</TableCell>
                                <TableCell>
                                    <p className="font-medium">{note.studentName || note.actorName || 'Elev'}</p>
                                    <p className="text-xs text-gray-500">{note.className || '-'}</p>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">{note.dateKey || '-'}</TableCell>
                                <TableCell className="max-w-[420px]">
                                    <p className="text-sm text-gray-700">{note.reason || note.details || '-'}</p>
                                </TableCell>
                                <TableCell>
                                    {note.isJustified ? (
                                        <Badge className="bg-sky-100 text-sky-800 border border-sky-200">Marcat motivat</Badge>
                                    ) : (
                                        <Badge variant="outline">Neprocesat</Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        size="sm"
                                        variant={note.isJustified ? 'outline' : 'default'}
                                        disabled={note.isJustified || isApplyingId === note.id || !note.studentUserId || !note.dateKey}
                                        onClick={() => onApplyJustification?.(note)}
                                    >
                                        {isApplyingId === note.id ? 'Se aplica...' : 'Marcheaza absent motivat'}
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {notes.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="py-8 text-center text-gray-500">
                                    Nu exista scuze trimise de elevi pentru filtrele curente.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
