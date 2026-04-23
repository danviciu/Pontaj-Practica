import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getDayStatusMeta } from './attendance-status-presets';

function formatHeaderDay(dateKey) {
    const dateValue = new Date(`${dateKey}T12:00:00`);
    if (Number.isNaN(dateValue.getTime())) return dateKey;
    return format(dateValue, 'dd MMM', { locale: ro });
}

function formatHeaderWeekday(dateKey) {
    const dateValue = new Date(`${dateKey}T12:00:00`);
    if (Number.isNaN(dateValue.getTime())) return '';
    return format(dateValue, 'EEE', { locale: ro });
}

export default function DashboardAttendanceMatrix({
    students,
    dateKeys,
    getCellStatus,
    onCellClick,
    selectedDate,
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    Matrice prezenta pe perioada ({students.length} elevi)
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="sticky left-0 z-20 bg-white min-w-[240px] border-r">
                                Elev
                            </TableHead>
                            {dateKeys.map((dateKey) => (
                                <TableHead
                                    key={dateKey}
                                    className={`text-center min-w-[90px] ${dateKey === selectedDate ? 'bg-blue-50' : ''}`}
                                >
                                    <div className="font-semibold">{formatHeaderDay(dateKey)}</div>
                                    <div className="text-xs text-gray-500 uppercase">{formatHeaderWeekday(dateKey)}</div>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {students.map((student) => (
                            <TableRow key={student.id}>
                                <TableCell className="sticky left-0 z-10 bg-white border-r">
                                    <div className="space-y-0.5">
                                        <p className="font-medium leading-tight">{student.full_name}</p>
                                        <p className="text-xs text-gray-500 leading-tight">
                                            {student.className || 'Fara clasa'}
                                            {student.operatorId ? '' : ' | Nealocat'}
                                        </p>
                                    </div>
                                </TableCell>
                                {dateKeys.map((dateKey) => {
                                    const cellStatus = getCellStatus(student, dateKey);
                                    const meta = getDayStatusMeta(cellStatus.kind);
                                    const tooltipLabel = [
                                        `${meta.label}`,
                                        cellStatus.reasonLabel ? `Motiv: ${cellStatus.reasonLabel}` : '',
                                        cellStatus.validationMessage ? `Detalii: ${cellStatus.validationMessage}` : '',
                                    ].filter(Boolean).join(' | ');

                                    return (
                                        <TableCell key={`${student.id}_${dateKey}`} className="text-center">
                                            <button
                                                type="button"
                                                title={tooltipLabel}
                                                onClick={() => onCellClick?.(student, dateKey, cellStatus)}
                                                className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-xs font-semibold ${meta.badgeClassName} ${cellStatus.attendance ? 'hover:ring-2 hover:ring-blue-300' : ''}`}
                                            >
                                                {meta.shortLabel}
                                            </button>
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                        {students.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={Math.max(2, dateKeys.length + 1)} className="py-8 text-center text-gray-500">
                                    Nu exista elevi pentru filtrele selectate.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
