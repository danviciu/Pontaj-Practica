import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Search, Users, Download, Mail, MapPin } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

export default function OperatorStudentsList() {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOperator, setSelectedOperator] = useState('all');
    const [selectedClass, setSelectedClass] = useState('all');

    const { data: operators = [] } = useQuery({
        queryKey: ['operators'],
        queryFn: () => base44.entities.Operator.list('-created_date', 100),
    });

    const { data: students = [] } = useQuery({
        queryKey: ['students'],
        queryFn: async () => {
            const users = await base44.entities.User.list('-created_date', 500);
            return users.filter((u) => u.role === 'user' || !u.role);
        },
    });

    const classes = [...new Set(students.map((s) => s.className).filter(Boolean))];

    const filteredStudents = students.filter((student) => {
        if (selectedOperator !== 'all' && student.operatorId !== selectedOperator) return false;
        if (selectedClass !== 'all' && student.className !== selectedClass) return false;
        if (searchTerm && !student.full_name?.toLowerCase().includes(searchTerm.toLowerCase()))
            return false;
        return true;
    });

    const groupedStudents = filteredStudents.reduce((acc, student) => {
        const opId = student.operatorId || 'unassigned';
        if (!acc[opId]) acc[opId] = [];
        acc[opId].push(student);
        return acc;
    }, {});

    const handleExportCSV = (operatorId = null) => {
        const headers = ['Nume Student', 'Email', 'Clasa', 'Specializare', 'Operator', 'Status'];

        let studentsToExport = filteredStudents;
        if (operatorId && operatorId !== 'unassigned') {
            studentsToExport = filteredStudents.filter((s) => s.operatorId === operatorId);
        } else if (operatorId === 'unassigned') {
            studentsToExport = filteredStudents.filter((s) => !s.operatorId);
        }

        const rows = studentsToExport.map((student) => {
            const operator = operators.find((o) => o.id === student.operatorId);
            return [
                student.full_name,
                student.email,
                student.className || '',
                student.specialization || '',
                operator?.name || 'Nealocați',
                student.isActive ? 'Activ' : 'Inactiv',
            ];
        });

        const csv = [headers, ...rows]
            .map((row) => row.map((cell) => `"${cell}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const operatorName = operatorId
            ? operators.find((o) => o.id === operatorId)?.name || 'nealocati'
            : 'toti';
        link.download = `elevi_${operatorName}.csv`;
        link.click();
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Liste Elevi per Operator</h1>
                        <p className="text-gray-500 mt-1">Vizualizează și gestionează repartizările</p>
                    </div>
                    <Button
                        onClick={() => handleExportCSV()}
                        className="bg-green-600 hover:bg-green-700"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Export Toate
                    </Button>
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Căutare</label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <Input
                                        placeholder="Nume student..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-9"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Operator</label>
                                <Select value={selectedOperator} onValueChange={setSelectedOperator}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Toți Operatorii</SelectItem>
                                        {operators.map((op) => (
                                            <SelectItem key={op.id} value={op.id}>
                                                {op.name}
                                            </SelectItem>
                                        ))}
                                        <SelectItem value="unassigned">Nealocați</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Clasă</label>
                                <Select value={selectedClass} onValueChange={setSelectedClass}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Toate Clasele</SelectItem>
                                        {classes.map((cls) => (
                                            <SelectItem key={cls} value={cls}>
                                                {cls}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500">Total Elevi</p>
                                    <p className="text-3xl font-bold mt-1">{filteredStudents.length}</p>
                                </div>
                                <Users className="h-10 w-10 text-blue-600" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500">Operatori Activi</p>
                                    <p className="text-3xl font-bold mt-1">
                                        {operators.filter((o) => o.isActive).length}
                                    </p>
                                </div>
                                <Building2 className="h-10 w-10 text-green-600" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500">Elevi Nealocați</p>
                                    <p className="text-3xl font-bold mt-1">
                                        {students.filter((s) => !s.operatorId).length}
                                    </p>
                                </div>
                                <Users className="h-10 w-10 text-orange-600" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Student Lists by Operator */}
                <div className="space-y-6">
                    {Object.entries(groupedStudents).map(([operatorId, studentsInGroup]) => {
                        const operator = operators.find((o) => o.id === operatorId);
                        const operatorName = operator?.name || 'Nealocați';

                        return (
                            <Card key={operatorId}>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Building2 className="h-5 w-5 text-blue-600" />
                                            <div>
                                                <CardTitle className="text-lg">{operatorName}</CardTitle>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    {studentsInGroup.length} elev{studentsInGroup.length !== 1 ? 'i' : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleExportCSV(operatorId)}
                                            className="text-green-600 hover:text-green-700"
                                        >
                                            <Download className="h-4 w-4 mr-1" />
                                            Export
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {operator && (
                                        <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-start gap-2 text-sm">
                                            <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                                            <div>
                                                <p className="text-gray-600">{operator.address || 'Fără adresă'}</p>
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Coordonate: {operator.lat.toFixed(4)}, {operator.lng.toFixed(4)} • Rază:{' '}
                                                    {operator.radiusMeters}m
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {studentsInGroup.map((student) => (
                                            <Card key={student.id} className="bg-white hover:shadow-md transition-shadow">
                                                <CardContent className="pt-4">
                                                    <div className="space-y-2">
                                                        <div>
                                                            <p className="font-semibold text-sm">{student.full_name}</p>
                                                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                                                <Mail className="h-3 w-3" />
                                                                {student.email}
                                                            </p>
                                                        </div>
                                                        <div className="flex gap-2 flex-wrap">
                                                            <Badge variant="outline" className="text-xs">
                                                                {student.className || 'Fără clasă'}
                                                            </Badge>
                                                            {student.specialization && (
                                                                <Badge variant="outline" className="text-xs bg-blue-50">
                                                                    {student.specialization}
                                                                </Badge>
                                                            )}
                                                            <Badge
                                                                variant={student.isActive ? 'default' : 'secondary'}
                                                                className="text-xs"
                                                            >
                                                                {student.isActive ? 'Activ' : 'Inactiv'}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}

                    {Object.keys(groupedStudents).length === 0 && (
                        <Card>
                            <CardContent className="py-12 text-center text-gray-500">
                                Niciun elev găsit pentru filtrele selectate
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}