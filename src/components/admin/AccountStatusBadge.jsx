import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function AccountStatusBadge({ isActive, className = '' }) {
    const active = isActive !== false;
    return (
        <Badge
            variant="outline"
            className={`${active
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-700 border-slate-200'} ${className}`}
        >
            {active ? (
                <><CheckCircle className="h-3 w-3 mr-1" />Activ</>
            ) : (
                <><XCircle className="h-3 w-3 mr-1" />Inactiv</>
            )}
        </Badge>
    );
}
