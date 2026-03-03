import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import StudentListItem from '@/components/admin/StudentListItem';

export default function DashboardStudentLists({
    groupedStudents,
    operators,
    attendancesByStudentId,
    studentStatusInfoById,
    handleExportCSV,
    handleStudentClick
}) {
    return (
        <div className="space-y-6">
            {Object.entries(groupedStudents).map(([operatorId, studentsInGroup]) => {
                const operator = operators.find((operatorItem) => operatorItem.id === operatorId);
                const operatorName = operator?.name || 'Nealocati';
                const presentInGroup = studentsInGroup.filter((student) => (
                    studentStatusInfoById.get(student.id)?.dashboardStatus === 'PRESENT'
                )).length;
                const absentInGroup = studentsInGroup.filter((student) => (
                    studentStatusInfoById.get(student.id)?.dashboardStatus === 'ABSENT'
                )).length;
                const pendingInGroup = studentsInGroup.filter((student) => (
                    studentStatusInfoById.get(student.id)?.dashboardStatus === 'PENDING'
                )).length;

                return (
                    <Card key={operatorId}>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    {operatorName}
                                    <span className="text-sm font-normal text-gray-500">
                                        ({studentsInGroup.length} elevi)
                                    </span>
                                </CardTitle>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 text-sm">
                                        <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded-full bg-green-500" />
                                            <span className="text-gray-600">{presentInGroup}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded-full bg-red-500" />
                                            <span className="text-gray-600">{absentInGroup}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <div className="w-3 h-3 rounded-full bg-amber-500" />
                                            <span className="text-gray-600">{pendingInGroup}</span>
                                        </div>
                                    </div>
                                    {operatorId !== 'unassigned' && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleExportCSV(operatorId)}
                                            className="text-green-600 hover:text-green-700"
                                        >
                                            <Download className="h-4 w-4 mr-1" />
                                            Export
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {studentsInGroup.map((student) => {
                                    const attendance = attendancesByStudentId.get(student.id);
                                    const statusInfo = studentStatusInfoById.get(student.id);
                                    return (
                                        <StudentListItem
                                            key={student.id}
                                            student={student}
                                            attendance={attendance}
                                            statusInfo={statusInfo}
                                            onClick={() => handleStudentClick(student)}
                                        />
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}

            {Object.keys(groupedStudents).length === 0 && (
                <Card>
                    <CardContent className="py-12 text-center text-gray-500">
                        Niciun student gasit pentru filtrele selectate
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
