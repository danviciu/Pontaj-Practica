import React from 'react';
import { Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function StatusIndicator({ isPresent, size = 'default', variant }) {
    const sizeClasses = {
        small: 'w-3 h-3',
        default: 'w-4 h-4',
        large: 'w-6 h-6',
    };
    const resolvedVariant = variant || (isPresent ? 'present' : 'absent');
    const variantClasses = {
        present: 'fill-green-500 text-green-500',
        absent: 'fill-red-500 text-red-500',
        pending: 'fill-amber-500 text-amber-500',
    };

    return (
        <div className="flex items-center gap-2">
            <Circle
                className={cn(
                    sizeClasses[size],
                    variantClasses[resolvedVariant] || variantClasses.absent
                )}
            />
        </div>
    );
}
