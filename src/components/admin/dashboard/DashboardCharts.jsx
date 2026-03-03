import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

export default function DashboardCharts({
    weekAttendances,
    presentCount,
    absentCount,
    pendingCount,
    operatorDistribution,
    classDistribution,
}) {
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
    const statusData = [
        { name: 'Prezenti', value: presentCount, color: '#10b981' },
        { name: 'Absenti', value: absentCount, color: '#ef4444' },
        { name: 'Pending', value: pendingCount, color: '#f59e0b' },
    ];

    return (
        <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
                <TabsTrigger value="overview">Prezentare Generala</TabsTrigger>
                <TabsTrigger value="trends">Tendinte Prezenta</TabsTrigger>
                <TabsTrigger value="distribution">Distributie</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Prezenta Ultimele 7 Zile</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={weekAttendances}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(date) => format(new Date(date), 'dd MMM', { locale: ro })}
                                    />
                                    <YAxis />
                                    <Tooltip
                                        labelFormatter={(date) => format(new Date(date), 'dd MMMM yyyy', { locale: ro })}
                                    />
                                    <Legend />
                                    <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} name="Prezente" />
                                </LineChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Status Azi</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie
                                        data={statusData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={({ name, percent, value }) => {
                                            if (!value || percent <= 0) return '';
                                            return `${name} ${(percent * 100).toFixed(0)}%`;
                                        }}
                                        outerRadius={100}
                                        dataKey="value"
                                    >
                                        {statusData.map((entry) => (
                                            <Cell key={entry.name} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </TabsContent>

            <TabsContent value="trends" className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Evolutie Prezenta</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={400}>
                            <BarChart data={weekAttendances}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(date) => format(new Date(date), 'EEE dd', { locale: ro })}
                                />
                                <YAxis />
                                <Tooltip
                                    labelFormatter={(date) => format(new Date(date), 'EEEE, dd MMMM yyyy', { locale: ro })}
                                />
                                <Legend />
                                <Bar dataKey="count" fill="#3b82f6" name="Numar prezente" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="distribution" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Distributie Elevi pe Operatori</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={operatorDistribution} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" />
                                    <YAxis dataKey="name" type="category" width={120} />
                                    <Tooltip />
                                    <Bar dataKey="count" fill="#3b82f6" name="Elevi" />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Distributie Elevi pe Clase</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie
                                        data={classDistribution}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={({ name, value }) => `${name}: ${value}`}
                                        outerRadius={100}
                                        dataKey="count"
                                    >
                                        {classDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </TabsContent>
        </Tabs>
    );
}
