import { CalendarSurface } from '../features/calendar/CalendarSurface';
import { BrandingPreview } from '../features/branding/BrandingPreview';
import { QueuePanel } from '../features/queue/QueuePanel';

export function StaffWorkspace() {
  return (
    <div className="space-y-6">
      <CalendarSurface mode="personal" />
      <div className="grid gap-6 lg:grid-cols-2">
        <QueuePanel variant="compact" />
        <BrandingPreview />
      </div>
    </div>
  );
}
