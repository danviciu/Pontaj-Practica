import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getValidationReasonLabel } from '@/lib/attendance-labels';

export default function DashboardFilters({
    selectedPeriod, setSelectedPeriod, periods,
    selectedDate, setSelectedDate,
    selectedOperator, setSelectedOperator, operators,
    selectedClass, setSelectedClass, classes,
    selectedValidationStatus, setSelectedValidationStatus, validationStatuses,
    selectedValidationReason, setSelectedValidationReason, validationReasons,
    searchTerm, setSearchTerm,
    handleExportCSV
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Filtre</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Perioada practica</label>
                        <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Toate perioadele</SelectItem>
                                {periods.filter((period) => period.isActive).map((period) => (
                                    <SelectItem key={period.id} value={period.id}>
                                        {period.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Data</label>
                        <Input
                            type="date"
                            value={selectedDate}
                            onChange={(event) => setSelectedDate(event.target.value)}
                            className="w-full"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Operator</label>
                        <Select value={selectedOperator} onValueChange={setSelectedOperator}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Toti operatorii</SelectItem>
                                {operators.map((operatorItem) => (
                                    <SelectItem key={operatorItem.id} value={operatorItem.id}>
                                        {operatorItem.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Clasa</label>
                        <Select value={selectedClass} onValueChange={setSelectedClass}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Toate clasele</SelectItem>
                                {classes.map((className) => (
                                    <SelectItem key={className} value={className}>
                                        {className}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Status validare</label>
                        <Select value={selectedValidationStatus} onValueChange={setSelectedValidationStatus}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Toate</SelectItem>
                                <SelectItem value="PENDING">Pending</SelectItem>
                                <SelectItem value="ABSENT">Absent</SelectItem>
                                <SelectItem value="NEPONTAT">Nepontat</SelectItem>
                                {validationStatuses.map((statusValue) => (
                                    <SelectItem key={statusValue} value={statusValue}>
                                        {statusValue}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Motiv validare</label>
                        <Select value={selectedValidationReason} onValueChange={setSelectedValidationReason}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Toate motivele</SelectItem>
                                {validationReasons.map((reasonValue) => (
                                    <SelectItem key={reasonValue} value={reasonValue}>
                                        {getValidationReasonLabel(reasonValue)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Cautare</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Nume student..."
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-4 flex justify-end">
                    <Button onClick={() => handleExportCSV()} className="bg-green-600 hover:bg-green-700">
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV (toate)
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
